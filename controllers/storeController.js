/**
 * Get all stores for the current user
 * GET /api/stores/my
 */
exports.getMyStores = async (req, res) => {
  try {
    const stores = await Store.find({ user: req.user._id });
    res.json({ success: true, data: stores });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create a new store
 * POST /api/stores
 */
exports.createStore = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Дэлгүүрийн нэр шаардлагатай" });
    }

    const store = await Store.create({
      user: req.user._id,
      name,
      facebookPageId: "pending",
      facebookPageToken: "pending",
    });

    res.status(201).json({ success: true, data: store });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const axios = require("axios");
const googleSheetsService = require("../services/googleSheetsService");
const { Store } = require("../models");

/**
 * Get available Facebook Pages for a user
 * POST /api/stores/facebook/pages
 */
exports.getFacebookPages = async (req, res) => {
  try {
    const { userAccessToken } = req.body;

    if (!userAccessToken) {
      return res
        .status(400)
        .json({ success: false, message: "User Access Token is required" });
    }

    // Fetch pages from Facebook Graph API
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/me/accounts`,
      {
        params: {
          access_token: userAccessToken,
          fields:
            "name,id,access_token,category,picture,instagram_business_account",
        },
      },
    );

    res.json({ success: true, data: response.data.data });
  } catch (error) {
    console.error(
      "❌ Get FB Pages Error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      success: false,
      message: "Facebook-ээс мэдээлэл авахад алдаа гарлаа",
    });
  }
};

/**
 * Connect a specific Facebook Page to a store
 * POST /api/stores/facebook/connect
 */
exports.connectFacebookPage = async (req, res) => {
  try {
    const { pageId, pageAccessToken, pageName, logoUrl, instagramBusinessId } =
      req.body;

    if (!pageId || !pageAccessToken) {
      return res
        .status(400)
        .json({ success: false, message: "Page ID and Token are required" });
    }

    // 1. Check if MUST update an existing store or CREATE a new one
    // Logic: Find store by facebookPageId OR create new
    let store = await Store.findOne({
      facebookPageId: pageId,
      user: req.user._id,
    });

    if (store) {
      // Update existing
      store.facebookPageToken = pageAccessToken;
      store.name = pageName || store.name;
      store.logoUrl = logoUrl || store.logoUrl;
      store.instagramBusinessId =
        instagramBusinessId || store.instagramBusinessId;
      await store.save();
    } else {
      // Create new store from Facebook Page
      store = await Store.create({
        user: req.user._id,
        name: pageName || "Шинэ дэлгүүр",
        logoUrl: logoUrl || "",
        facebookPageId: pageId,
        facebookPageToken: pageAccessToken,
        instagramBusinessId: instagramBusinessId || null,
      });
    }

    // Senior Automation: Automatically subscribe the page to our app's webhooks
    try {
      console.log(`📡 Subscribing Page ${pageId} to webhooks...`);
      await axios.post(
        `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`,
        {
          subscribed_fields: [
            "messages",
            "messaging_postbacks",
            "messaging_optins",
            "message_deliveries",
            "messaging_referrals",
          ],
        },
        {
          params: { access_token: pageAccessToken },
        },
      );
      console.log(`✅ Page ${pageId} successfully subscribed to webhooks.`);
    } catch (fbErr) {
      console.error(
        "⚠️ Auto-subscription failed:",
        fbErr.response?.data || fbErr.message,
      );
      // We don't block the whole process if this fails, but log it
    }

    res.json({
      success: true,
      message: "Facebook хуудас амжилттай холбогдлоо",
      data: store,
    });
  } catch (error) {
    console.error("❌ Connect FB Page Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Configure Google Sheet for a store
 * POST /api/stores/:id/configure-sheet
 */
exports.configureSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const { sheetUrl } = req.body;

    if (!sheetUrl) {
      return res
        .status(400)
        .json({ success: false, message: "URL шаардлагатай" });
    }

    // 1. Extract and Verify
    const sheetId = googleSheetsService.extractSheetId(sheetUrl);
    console.log(`🔍 Verifying access for Sheet ID: ${sheetId}`);

    const verification = await googleSheetsService.verifySheetAccess(sheetId);

    if (!verification.success) {
      return res.status(400).json(verification);
    }

    // 2. Update Store (with Ownership check)
    const store = await Store.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { googleSheetId: sheetId },
      { new: true },
    );

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Дэлгүүр олдсонгүй эсвэл хандах эрхгүй байна",
      });
    }

    // 3. Initial Sync (Optional but recommended for UX)
    console.log(
      `✅ Sheet configured for ${store.name}. Triggering initial sync...`,
    );
    googleSheetsService
      .syncProductsFromSheet(store._id, sheetId)
      .catch((err) => {
        console.error("Initial sync failed:", err.message);
      });

    return res.status(200).json({
      success: true,
      message: "Google Sheet амжилттай холбогдлоо",
      data: {
        storeName: store.name,
        sheetTitle: verification.title,
        sheetId: sheetId,
      },
    });
  } catch (error) {
    console.error("❌ Configure Sheet Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get settings for the user's primary store
 * GET /api/stores/settings
 */
exports.getSettings = async (req, res) => {
  try {
    const { storeId } = req.query;

    let store;

    if (storeId) {
      store = await Store.findOne({ _id: storeId, user: req.user._id });
    }

    if (!store) {
      store = await Store.findOne({ user: req.user._id });
    }

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "No stores found. Please create one.",
        needsOnboarding: true,
      });
    }

    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Дэлгүүр олдсонгүй" });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: store._id,
        name: store.name,
        logoUrl: store.logoUrl,
        facebookPageId: store.facebookPageId,
        instagramBusinessId: store.instagramBusinessId,
        googleSheetId: store.googleSheetId,
        customInstructions: store.customInstructions,
        columnMapping: store.columnMapping,
        hasDelivery: store.hasDelivery,
        deliveryFee: store.deliveryFee,
        deliveryTime: store.deliveryTime,
        pickupAddress: store.pickupAddress,
        paymentDetails: store.paymentDetails,
        paymentMethod: store.paymentMethod,
        sheetUrl: store.googleSheetId
          ? `https://docs.google.com/spreadsheets/d/${store.googleSheetId}`
          : "",
      },
    });
  } catch (error) {
    console.error("❌ Get Settings Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update settings for the user's store
 * PATCH /api/stores/settings
 */
exports.updateSettings = async (req, res) => {
  try {
    const { customInstructions, sheetUrl, storeId, name } = req.body;

    // Find store by user and optionally by ID (if provided for multi-store)
    const filter = { user: req.user._id };
    if (storeId) filter._id = storeId;

    let store = await Store.findOne(filter);

    if (!store) {
      return res
        .status(404)
        .json({ success: false, message: "Дэлгүүр олдсонгүй" });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (customInstructions !== undefined)
      updateData.customInstructions = customInstructions;

    if (req.body.hasDelivery !== undefined)
      updateData.hasDelivery = req.body.hasDelivery;

    if (req.body.deliveryFee !== undefined)
      updateData.deliveryFee = req.body.deliveryFee;

    if (req.body.deliveryTime !== undefined)
      updateData.deliveryTime = req.body.deliveryTime;

    if (req.body.pickupAddress !== undefined)
      updateData.pickupAddress = req.body.pickupAddress;

    if (req.body.paymentDetails !== undefined)
      updateData.paymentDetails = req.body.paymentDetails;

    if (req.body.paymentMethod !== undefined)
      updateData.paymentMethod = req.body.paymentMethod;

    if (req.body.columnMapping) {
      updateData.columnMapping = req.body.columnMapping;
    }

    if (sheetUrl) {
      const sheetId = googleSheetsService.extractSheetId(sheetUrl);
      const verification = await googleSheetsService.verifySheetAccess(sheetId);
      if (!verification.success) {
        return res.status(400).json(verification);
      }
      updateData.googleSheetId = sheetId;
    }

    store = await Store.findByIdAndUpdate(store._id, updateData, { new: true });

    // Trigger background sync if sheet or mapping was updated
    if (updateData.googleSheetId || updateData.columnMapping) {
      console.log(`🔄 Triggering automated sync for ${store.name}...`);
      googleSheetsService
        .syncProductsFromSheet(store._id, store.googleSheetId)
        .catch((err) => {
          console.error("Automated sync failed:", err.message);
        });
    }

    return res.status(200).json({
      success: true,
      message: "Тохиргоо амжилттай хадгалагдлаа",
      data: store,
    });
  } catch (error) {
    console.error("❌ Update Settings Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
