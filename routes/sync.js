const express = require("express");
const router = express.Router();
const syncController = require("../controllers/syncController");
const { protect } = require("../middleware/auth");

router.use(protect);

/**
 * POST /api/sync/products
 * Manually trigger product synchronization from Google Sheets
 */
router.post("/products", syncController.syncProducts);
router.post("/verify", syncController.verifySheet);
router.post("/analyze", syncController.analyzeSheet);

/**
 * POST /api/sync/verify
 * Verify access and structure of a Google Sheet without saving
 */
router.post("/verify", syncController.verifySheet);

module.exports = router;
