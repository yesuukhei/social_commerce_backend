const googleSheetsService = require("../services/googleSheetsService");
const { Store } = require("../models");

// Simple in-memory lock to prevent "Race Condition" and "DDoS" from bulk edits
const syncLocks = new Map();
const COOLDOWN_MS = 3000; // 3 seconds cooldown

/**
 * Trigger product synchronization from Google Sheets
 * POST /api/sync/products
 */
exports.syncProducts = async (req, res) => {
  try {
    const { storeId, sheetId } = req.body;

    // 1. Find the store
    let store;
    if (storeId) {
      store = await Store.findById(storeId);
    } else {
      // Fallback to first store for MVP/testing
      store = await Store.findOne();
    }

    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Store not found" });
    }

    const targetSheetId = sheetId || store.googleSheetId;

    if (!targetSheetId) {
      return res.status(400).json({
        success: false,
        message: "No Google Sheet ID provided or found for this store",
      });
    }

    const lockKey = store._id.toString();

    // 2. Race Condition Prevention (Cooldown Logic)
    const lastSync = syncLocks.get(lockKey);
    const now = Date.now();
    if (lastSync && now - lastSync < COOLDOWN_MS) {
      console.log(`⏳ Sync skipped (Cooldown): ${store.name}`);
      return res.status(429).json({
        success: false,
        message: "Хэт олон хүсэлт. Түр хүлээгээд дахин оролдоно уу.",
      });
    }
    syncLocks.set(lockKey, now);

    // 3. Perform Sync
    console.log(`🚀 Starting sync for store: ${store.name}`);
    const results = await googleSheetsService.syncProductsFromSheet(
      store._id,
      targetSheetId,
    );

    return res.status(200).json({
      success: true,
      message: "Synchronization completed successfully",
      data: results,
    });
  } catch (error) {
    console.error("❌ Sync Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Verify access and structure of a Google Sheet
 * POST /api/sync/verify
 */
exports.verifySheet = async (req, res) => {
  try {
    const { sheetUrl } = req.body;

    if (!sheetUrl) {
      return res.status(400).json({
        success: false,
        message: "URL шаардлагатай",
      });
    }

    const sheetId = googleSheetsService.extractSheetId(sheetUrl);
    const verification = await googleSheetsService.verifySheetAccess(sheetId);

    if (verification.success) {
      return res.status(200).json(verification);
    } else {
      return res.status(400).json(verification);
    }
  } catch (error) {
    console.error("❌ Verify Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Analyze sheet structure with AI
 * POST /api/sync/analyze
 */
exports.analyzeSheet = async (req, res) => {
  try {
    const { sheetUrl } = req.body;
    if (!sheetUrl) {
      return res
        .status(400)
        .json({ success: false, message: "URL шаардлагатай" });
    }

    const sheetId = googleSheetsService.extractSheetId(sheetUrl);
    const analysis = await googleSheetsService.analyzeSheetStructure(sheetId);

    res.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    console.error("❌ Analysis Controller Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
