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
router.post("/analyze-sheet", syncController.analyzeSheet);

module.exports = router;
