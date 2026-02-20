const express = require("express");
const router = express.Router();
const storeController = require("../controllers/storeController");
const { protect } = require("../middleware/auth");

router.use(protect);

/**
 * GET /api/stores/settings
 * Get settings for the default store
 */
router.get("/my", storeController.getMyStores);
router.get("/settings", storeController.getSettings);
router.post("/", storeController.createStore);

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

/**
 * Facebook Page Connection
 */
router.post("/facebook/pages", storeController.getFacebookPages);
router.post("/facebook/connect", storeController.connectFacebookPage);

module.exports = router;
