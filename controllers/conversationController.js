const { Conversation, Store } = require("../models");
const { getIO } = require("../utils/socket");

/**
 * GET /api/conversations
 * List all conversations for the authenticated user's stores
 */
exports.getAllConversations = async (req, res) => {
  try {
    // 1. Find stores owned by this user
    const userStores = await Store.find({ user: req.user._id }).select("_id");
    const storeIds = userStores.map((s) => s._id);

    if (storeIds.length === 0) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const { status, intent, search, storeId } = req.query;
    const filter = { store: { $in: storeIds } };

    if (storeId && storeIds.some((id) => id.toString() === storeId)) {
      filter.store = storeId;
    }

    if (status) filter.status = status;
    if (intent) filter.currentIntent = intent;

    // TODO: Add search by customer name if needed (requires populate/aggregation)

    const conversations = await Conversation.find(filter)
      .populate("customer", "name")
      .populate("store", "name")
      .sort({ lastActivity: -1 });

    res.json({
      success: true,
      count: conversations.length,
      data: conversations,
    });
  } catch (error) {
    console.error("❌ Get Conversations Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET /api/conversations/:id
 * Get details and full message history for a conversation
 */
exports.getConversationById = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id)
      .populate("customer")
      .populate("store", "name")
      .populate("orders");

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Security check: Ensure user owns the store
    const store = await Store.findOne({
      _id: conversation.store,
      user: req.user._id,
    });
    if (!store) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this conversation",
      });
    }

    res.json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error("❌ Get Conversation Detail Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * PUT /api/conversations/:id/status
 * Update conversation status (e.g., close, mark as order created)
 */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (
      !["active", "waiting_for_info", "order_created", "closed"].includes(
        status,
      )
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const conversation = await Conversation.findById(req.params.id);
    if (!conversation)
      return res.status(404).json({ success: false, message: "Not found" });

    // Check ownership
    const store = await Store.findOne({
      _id: conversation.store,
      user: req.user._id,
    });
    if (!store)
      return res.status(403).json({ success: false, message: "Denied" });

    conversation.status = status;
    await conversation.save();

    // Real-time Update
    getIO().emit("conversation-updated", {
      conversationId: conversation._id,
      status: conversation.status,
    });

    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/conversations/:id/toggle-manual
 * Toggle AI Manual Mode
 */
exports.toggleManualMode = async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation)
      return res.status(404).json({ success: false, message: "Not found" });

    // Check ownership
    const store = await Store.findOne({
      _id: conversation.store,
      user: req.user._id,
    });
    if (!store)
      return res.status(403).json({ success: false, message: "Denied" });

    conversation.isManualMode = !conversation.isManualMode;
    // If we turned manual mode ON, we might want to change status to active to ensure it's seen
    if (conversation.isManualMode) {
      conversation.status = "active";
    }

    await conversation.save();

    // Real-time Update
    getIO().emit("conversation-updated", {
      conversationId: conversation._id,
      isManualMode: conversation.isManualMode,
      status: conversation.status,
    });

    res.json({
      success: true,
      isManualMode: conversation.isManualMode,
      message: conversation.isManualMode
        ? "AI түр зогсоолоо"
        : "AI ажиллаж байна",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/conversations/:id/message
 * Send a manual message from Admin to Customer via Facebook Page
 */
exports.sendAdminMessage = async (req, res) => {
  try {
    const { text } = req.body;
    const conversationId = req.params.id;

    if (!text) {
      return res
        .status(400)
        .json({ success: false, message: "Message text is required" });
    }

    // 1. Find conversation and populate store
    const conversation =
      await Conversation.findById(conversationId).populate("store");
    if (!conversation) {
      return res
        .status(404)
        .json({ success: false, message: "Conversation not found" });
    }

    const store = conversation.store;

    // 2. Security Check: Ensure admin owns this store
    if (store.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // 3. Send message via Facebook Messenger Service
    const messengerService = require("../services/messengerService");
    await messengerService.sendMessage(
      conversation.facebookConversationId,
      { text: text },
      store.facebookPageToken,
    );

    // 4. Save message to local database history
    const newMessage = await conversation.addMessage("admin", text);

    // Real-time Update
    const io = getIO();
    io.to(conversationId).emit("new-message", newMessage);
    io.emit("conversation-updated", {
      conversationId,
      lastMessage: text,
      lastActivity: new Date(),
    });

    res.json({
      success: true,
      message: "Message sent successfully",
    });
  } catch (error) {
    console.error("❌ Send Admin Message Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
