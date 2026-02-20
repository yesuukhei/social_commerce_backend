const express = require("express");
const router = express.Router();
const conversationController = require("../controllers/conversationController");
const { protect } = require("../middleware/auth");

// All routes are protected
router.use(protect);

router.get("/", conversationController.getAllConversations);
router.get("/:id", conversationController.getConversationById);
router.put("/:id/status", conversationController.updateStatus);
router.patch("/:id/toggle-manual", conversationController.toggleManualMode);
router.post("/:id/message", conversationController.sendAdminMessage);

module.exports = router;
