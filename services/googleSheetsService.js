const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

/**
 * Service to handle Google Sheets operations
 */
class GoogleSheetsService {
  /**
   * Internal helper to get a fully initialized Google Spreadsheet instance
   * This is now "Stateless" to prevent race conditions
   * @param {string} sheetId
   */
  async getDoc(sheetId = null) {
    try {
      const spreadsheetId = sheetId || process.env.GOOGLE_SHEET_ID;
      const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      let privateKey = process.env.GOOGLE_PRIVATE_KEY;

      if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
        throw new Error("Google Sheets credentials or Spreadsheet ID missing");
      }

      // Robust decoding
      privateKey = privateKey.replace(/^"|"$/g, "").split("\\n").join("\n");
      if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
        privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
      }

      const auth = new JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });

      const doc = new GoogleSpreadsheet(spreadsheetId, auth);
      await doc.loadInfo();

      return doc;
    } catch (error) {
      console.error("❌ Google Sheets Connection Error:", error.message);
      throw error;
    }
  }

  /**
   * Extract Spreadsheet ID from a full Google Sheets URL
   */
  extractSheetId(url) {
    if (!url) return null;
    const matches = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return matches ? matches[1] : url;
  }

  /**
   * Verify if the service has access to the sheet and check its structure
   */
  async verifySheetAccess(sheetId) {
    try {
      const doc = await this.getDoc(sheetId);

      const productsSheet =
        doc.sheetsByTitle["Products"] ||
        doc.sheetsByTitle["Бараа"] ||
        doc.sheetsByIndex[0];

      await productsSheet.loadHeaderRow();

      return {
        success: true,
        title: doc.title,
        sheetName: productsSheet.title,
        headers: productsSheet.headerValues,
        rowCount: productsSheet.rowCount,
      };
    } catch (error) {
      console.error("❌ Sheet Verification Failed:", error.message);
      return {
        success: false,
        message: error.message.includes("403")
          ? "Эрх чөлөөгүй (403). Манай и-мэйлд 'Editor' эрх өгнө үү."
          : "Spreadsheet олдсонгүй эсвэл ID буруу байна.",
      };
    }
  }

  /**
   * Analyze sheet structure using AI to map unknown headers
   * @param {string} sheetId
   * @returns {Object} Header mapping
   */
  async analyzeSheetStructure(sheetId = null) {
    const doc = await this.getDoc(sheetId);

    let sheet =
      doc.sheetsByTitle["Products"] ||
      doc.sheetsByTitle["Бараа"] ||
      doc.sheetsByTitle["Бүтээгдэхүүн"] ||
      doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    const headers = sheet.headerValues;

    // Fetch first 5 rows for semantic analysis
    const rows = await sheet.getRows({ limit: 5 });
    const sampleData = rows.map((row) => {
      const obj = {};
      headers.forEach((h) => (obj[h] = row.get(h)));
      return obj;
    });

    const aiService = require("./aiService");
    const mapping = await aiService.mapSheetHeaders(headers, sampleData);

    return {
      sheetId: doc.spreadsheetId,
      sheetTitle: doc.title,
      headers,
      mapping,
    };
  }

  /**
   * Append a new order row to the spreadsheet
   * @param {Object} order - The order document
   * @param {string} sheetId - Store-specific sheet ID
   */
  async appendOrder(order, sheetId = null) {
    try {
      const doc = await this.getDoc(sheetId);
      const sheet = doc.sheetsByIndex[0]; // Assumes first sheet

      // Load the header row to verify
      await sheet.loadHeaderRow();
      console.log("📊 Sheet Headers found:", sheet.headerValues);

      // Create row data - simplified keys to match exactly
      const rowData = {
        Огноо: order.createdAt,
        "Захиалгын ID": order._id.toString(),
        Үйлчлүүлэгч: order.customer?.name || "Unknown",
        Утас: order.phoneNumber || "",
        Хаяг: order.address || "",
        Бараа: order.items
          ? order.items
              .map((item) => `${item.itemName} (${item.quantity})`)
              .join(", ")
          : "",
        "Нийт дүн": order.totalAmount || 0,
        Төлөв: order.status || "pending",
        "AI Confidence": order.aiExtraction?.confidence || 0,
        Notes: order.notes || "",
      };

      console.log(
        "📝 Attempting to add row:",
        JSON.stringify(rowData, null, 2),
      );

      await sheet.addRow(rowData);
      console.log(`✅ Order ${order._id} synced to Google Sheets successfully`);
    } catch (error) {
      console.error("❌ Error syncing to Google Sheets:", error.message);
    }
  }

  /**
   * Fetch and sync products from a spreadsheet to the database
   * @param {string} storeId - The store ID to link products to
   * @param {string} sheetId - The spreadsheet ID
   * @returns {Object} Sync results (count, errors)
   */
  async syncProductsFromSheet(storeId, sheetId = null, userId = null) {
    try {
      const Product = require("../models/Product");
      const { Store } = require("../models");

      const doc = await this.getDoc(sheetId);

      // Fetch the store to get its column mapping
      const store = await Store.findById(storeId);
      const mapping = store?.columnMapping || {};

      let sheet =
        doc.sheetsByTitle["Products"] ||
        doc.sheetsByTitle["Бараа"] ||
        doc.sheetsByIndex[0];

      const allRows = await sheet.getRows();

      // Senior UX & Performance Fix: Filter out logically empty rows (no identity)
      const nameCol = mapping.name || "Нэр";
      const rows = allRows.filter((row) => {
        const name = row.get(nameCol);
        return name && String(name).trim() !== "";
      });

      console.log(
        `🔄 Found ${allRows.length} raw rows. Syncing ${rows.length} valid products from sheet: ${sheet.title}`,
      );

      let successCount = 0;
      let errorCount = 0;
      const syncedProductNames = [];

      await sheet.loadHeaderRow();
      const headers = sheet.headerValues;

      // Update store's headers in database
      if (store) {
        store.sheetHeaders = headers;
        // Ensure user is set to avoid validation errors
        if (!store.user && userId) {
          store.user = userId;
        }
        await store.save();
      }

      for (const row of rows) {
        try {
          // Use Mapping if available, else fallback to defaults
          const priceCol = mapping.price || "Үнэ";
          const stockCol = mapping.stock || "Үлдэгдэл";
          const catCol = mapping.category; // Optional now
          const name = row.get(nameCol);
          const trimmedName = String(name).trim();
          const category = catCol ? String(row.get(catCol) || "").trim() : "";

          // Composite key to allow same name in different categories
          const productKey = `${trimmedName}-${category}`;
          syncedProductNames.push(productKey);

          let priceStr = String(row.get(priceCol) || "").trim();
          let stockStr = String(row.get(stockCol) || "").trim();

          // Robust Sanitization: Only parse if there are numbers
          const hasNumbers = (str) => /[0-9]/.test(str);

          const price = hasNumbers(priceStr)
            ? parseFloat(priceStr.replace(/[^0-9.]/g, ""))
            : 0;

          const stock = hasNumbers(stockStr)
            ? parseInt(stockStr.replace(/[^0-9]/g, ""))
            : 0;

          // 2. Dynamic Attributes: Capture everything else
          const attributes = {};
          const mappedCols = [nameCol, priceCol, stockCol, catCol, "AI Status"];

          headers.forEach((h) => {
            if (!mappedCols.includes(h)) {
              const val = row.get(h);
              if (
                val !== undefined &&
                val !== null &&
                String(val).trim() !== ""
              ) {
                attributes[h] = String(val);
              }
            }
          });

          // 3. Upsert in Database
          await Product.findOneAndUpdate(
            { store: storeId, name: trimmedName, category: category },
            {
              store: storeId,
              name: trimmedName,
              price: price,
              stock: stock,
              category,
              attributes: attributes,
              isActive: true,
            },
            { upsert: true, new: true },
          );

          // 3. Status Feedback
          if (sheet.headerValues.includes("AI Status")) {
            row.set(
              "AI Status",
              `✅ Synced: ${new Date().toLocaleTimeString()}`,
            );
            await row.save();
          }

          successCount++;
        } catch (rowError) {
          console.error(`❌ Error syncing row: ${rowError.message}`);
          errorCount++;
        }
      }

      // 4. Soft Delete: Deactivate products not in the sheet
      // We need to fetch all products for this store and compare using name+category
      const allProducts = await Product.find({
        store: storeId,
        isActive: true,
      });
      let deactivatedCount = 0;

      for (const product of allProducts) {
        const productKey = `${product.name}-${product.category || ""}`;
        if (!syncedProductNames.includes(productKey)) {
          product.isActive = false;
          await product.save();
          deactivatedCount++;
        }
      }

      console.log(
        `✅ Sync Completed: ${successCount} success, ${errorCount} errors. Deactivated: ${deactivatedCount}`,
      );
      return {
        successCount,
        errorCount,
        deactivatedCount,
      };
    } catch (error) {
      console.error("❌ Product Sync Error:", error.message);
      throw error;
    }
  }

  /**
   * Update a specific product's stock in the Google Sheet (Two-Way Sync)
   * Called when an order is placed to keep Sheets updated
   */
  async updateProductStock(sheetId, productName, newStock) {
    try {
      await this.init(sheetId);
      if (!this.initialized) return;

      let sheet =
        this.doc.sheetsByTitle["Products"] ||
        this.doc.sheetsByTitle["Бараа"] ||
        this.doc.sheetsByIndex[0];

      const rows = await sheet.getRows();
      const row = rows.find(
        (r) => (r.get("Нэр") || r.get("Name")) === productName,
      );

      if (row) {
        const stockKey =
          row.get("Үлдэгдэл") !== undefined ? "Үлдэгдэл" : "Stock";
        row.set(stockKey, newStock);
        row.set("AI Status", `📦 Order: ${new Date().toLocaleTimeString()}`);
        await row.save();
        console.log(
          `✅ Sheets stock updated for: ${productName} -> ${newStock}`,
        );
      }
    } catch (error) {
      console.error("❌ Error updating Sheets stock:", error.message);
    }
  }

  /**
   * Legacy method - kept for backward compatibility but enhanced
   */
  async getProductsFromSheet(sheetId) {
    try {
      const doc = await this.getDoc(sheetId);
      const sheet =
        doc.sheetsByTitle["Products"] ||
        doc.sheetsByTitle["Бараа"] ||
        doc.sheetsByIndex[0];

      const rows = await sheet.getRows();

      return rows
        .map((row) => ({
          name: row.get("Нэр") || row.get("Name"),
          price: parseFloat(row.get("Үнэ") || row.get("Price") || 0),
          stock: parseInt(row.get("Үлдэгдэл") || row.get("Stock") || 0),
          category: row.get("Төрөл") || row.get("Category"),
          description: row.get("Тайлбар") || row.get("Description"),
          isActive: true,
        }))
        .filter((p) => p.name);
    } catch (error) {
      console.error("❌ Error fetching products from Sheets:", error.message);
      return [];
    }
  }
}

module.exports = new GoogleSheetsService();
