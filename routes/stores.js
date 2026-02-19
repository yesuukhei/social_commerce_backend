const express = require("express");
const router = express.Router();
const storeController = require("../controllers/storeController");

/**
 * GET /api/stores/settings
 * Get settings for the default store
 */
router.get("/settings", storeController.getSettings);

/**
 * PATCH /api/stores/settings
 * Update settings for the default store
 */
router.patch("/settings", storeController.updateSettings);

/**
 * POST /api/stores/:id/configure-sheet
 * Set Google Sheet URL for a specific store
 */
router.post("/:id/configure-sheet", storeController.configureSheet);

module.exports = router;
