const express = require("express");
const router = express.Router();
const syncController = require("../controllers/syncController");

/**
 * POST /api/sync/products
 * Manually trigger product synchronization from Google Sheets
 */
router.post("/products", syncController.syncProducts);

/**
 * POST /api/sync/verify
 * Verify access and structure of a Google Sheet without saving
 */
router.post("/verify", syncController.verifySheet);

module.exports = router;
