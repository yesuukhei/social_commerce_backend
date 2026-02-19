const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

/**
 * Service to handle Google Sheets operations
 */
class GoogleSheetsService {
  constructor() {
    this.doc = null;
    this.initialized = false;
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
      await this.init(sheetId);
      if (!this.initialized) throw new Error("Could not initialize connection");

      const productsSheet =
        this.doc.sheetsByTitle["Products"] ||
        this.doc.sheetsByTitle["Бараа"] ||
        this.doc.sheetsByIndex[0];

      await productsSheet.loadHeaderRow();

      return {
        success: true,
        title: this.doc.title,
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
   * Initialize the Google Spreadsheet connection
   * @param {string} sheetId - Optional specific sheet ID to load
   */
  async init(sheetId = null, forceRefresh = false) {
    try {
      const spreadsheetId = sheetId || process.env.GOOGLE_SHEET_ID;

      // If already initialized with this sheet, skip unless forced
      if (
        this.initialized &&
        this.doc?.spreadsheetId === spreadsheetId &&
        !forceRefresh
      )
        return;

      const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      let privateKey = process.env.GOOGLE_PRIVATE_KEY;

      if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
        console.warn("⚠️ Google Sheets credentials missing");
        return;
      }

      // Robust decoding for .env or direct environment variables
      try {
        // Remove literal quotes and convert \n to real newlines
        privateKey = privateKey.replace(/^"|"$/g, "").split("\\n").join("\n");

        // Ensure the headers are clean
        if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
          privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
        }
      } catch (e) {
        console.error("Error formatting private key:", e.message);
      }

      const auth = new JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });

      this.doc = new GoogleSpreadsheet(spreadsheetId, auth);
      await this.doc.loadInfo();

      console.log(`✅ Connected to Google Sheet: ${this.doc.title}`);
      this.initialized = true;
    } catch (error) {
      console.error("❌ Google Sheets Init Error:", error.message);
      this.initialized = false;
    }
  }

  /**
   * Analyze sheet structure using AI to map unknown headers
   * @param {string} sheetId
   * @returns {Object} Header mapping
   */
  async analyzeSheetStructure(sheetId = null) {
    await this.init(sheetId);
    if (!this.initialized) throw new Error("Google Sheets not initialized");

    let sheet =
      this.doc.sheetsByTitle["Products"] ||
      this.doc.sheetsByTitle["Бараа"] ||
      this.doc.sheetsByTitle["Бүтээгдэхүүн"] ||
      this.doc.sheetsByIndex[0];
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
      sheetId: sheet.spreadsheetId,
      sheetTitle: sheet.title,
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
      await this.init(sheetId);
      if (!this.initialized) return;

      const sheet = this.doc.sheetsByIndex[0]; // Assumes first sheet

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
  async syncProductsFromSheet(storeId, sheetId = null) {
    try {
      const Product = require("../models/Product");
      const { Store } = require("../models");

      await this.init(sheetId, true); // Force refresh to see new columns/headers
      if (!this.initialized) throw new Error("Google Sheets not initialized");

      // Fetch the store to get its column mapping
      const store = await Store.findById(storeId);
      const mapping = store?.columnMapping || {};

      let sheet =
        this.doc.sheetsByTitle["Products"] ||
        this.doc.sheetsByTitle["Бараа"] ||
        this.doc.sheetsByIndex[0];

      const rows = await sheet.getRows();
      console.log(
        `🔄 Syncing ${rows.length} rows from sheet: ${sheet.title} using AI Mapping`,
      );

      let successCount = 0;
      let errorCount = 0;
      const syncedProductNames = [];

      await sheet.loadHeaderRow();

      for (const row of rows) {
        try {
          // Use Mapping if available, else fallback to defaults
          const nameCol = mapping.name || "Нэр";
          const priceCol = mapping.price || "Үнэ";
          const stockCol = mapping.stock || "Үлдэгдэл";
          const catCol = mapping.category || "Төрөл";
          const descCol = mapping.description || "Тайлбар";

          const name = row.get(nameCol);
          if (!name || String(name).trim() === "") continue;

          const trimmedName = String(name).trim();
          const category = String(
            row.get(catCol) || row.get("Category") || "",
          ).trim();

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

          const description = String(
            row.get(descCol) || row.get("Description") || "",
          ).trim();

          // 2. Dynamic Attributes: Capture everything else
          const attributes = new Map();
          const standardCols = [
            nameCol,
            priceCol,
            stockCol,
            catCol,
            descCol,
            "AI Status",
            "Name",
            "Price",
            "Stock",
            "Category",
            "Description",
          ];

          sheet.headerValues.forEach((h) => {
            if (!standardCols.includes(h)) {
              const val = row.get(h);
              if (
                val !== undefined &&
                val !== null &&
                String(val).trim() !== ""
              ) {
                attributes.set(h, String(val));
              }
            }
          });

          // 3. Upsert in Database (Sync-then-Serve)
          // We use name + category as the unique identifier for a product in a store
          await Product.findOneAndUpdate(
            { store: storeId, name: trimmedName, category: category },
            {
              store: storeId,
              name: trimmedName,
              description,
              price: price,
              stock: stock,
              category,
              attributes,
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
      await this.init(sheetId);
      if (!this.initialized) return [];

      let sheet =
        this.doc.sheetsByTitle["Products"] ||
        this.doc.sheetsByTitle["Бараа"] ||
        this.doc.sheetsByIndex[0];

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
