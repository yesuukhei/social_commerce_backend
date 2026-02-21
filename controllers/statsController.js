const { Order, Customer } = require("../models");

/**
 * Get store statistics
 * GET /api/stats
 */
exports.getStats = async (req, res) => {
  try {
    const { storeId, startDate, endDate } = req.query;

    // 1. Get all stores owned by this user
    const Store = require("../models/Store");
    const userStores = await Store.find({ user: req.user._id }).select("_id");
    const storeIds = userStores.map((s) => s._id.toString());

    if (storeIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          stats: [
            {
              label: "Нийт борлуулалт",
              value: "₮0",
              icon: "payments",
            },
            {
              label: "Амжилттай захиалга",
              value: "0",
              icon: "check_circle",
            },
            {
              label: "Хүлээгдэж буй",
              value: "0",
              icon: "pending_actions",
              color: "amber",
            },
            { label: "Шинэ хэрэглэгч", value: "0", icon: "group" },
          ],
          recentOrders: [],
          productCount: "0",
        },
      });
    }

    // Prepare query: filtered by user's stores, or a specific store if owned
    let query = { store: { $in: storeIds } };
    if (storeId && storeIds.includes(storeId)) {
      query.store = storeId;
    }

    // Apply Date Range Filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // Set to end of day
        query.createdAt.$lte = end;
      }
    }

    // 1. Total Sales & Order Count (Only completed orders count for revenue)
    const orders = await Order.find(query);
    const completedOrders = orders.filter((o) => o.status === "completed");

    const totalSales = completedOrders.reduce(
      (sum, order) => sum + (order.totalAmount || 0),
      0,
    );
    const orderCount = completedOrders.length;
    const pendingOrdersCount = orders.filter(
      (o) => o.status === "pending",
    ).length;

    // 2. AI Confidence Average
    const extractedOrders = orders.filter(
      (o) => o.aiExtraction && o.aiExtraction.confidence !== undefined,
    );
    const avgConfidence =
      extractedOrders.length > 0
        ? (extractedOrders.reduce(
            (sum, o) => sum + o.aiExtraction.confidence,
            0,
          ) /
            extractedOrders.length) *
          100
        : 0;

    // 3. New Customers (Store-specific)
    const Conversation = require("../models/Conversation");
    let conversationQuery = { store: query.store };

    if (startDate || endDate) {
      conversationQuery.createdAt = { ...query.createdAt };
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      conversationQuery.createdAt = { $gte: thirtyDaysAgo };
    }

    const newCustomersCount =
      await Conversation.countDocuments(conversationQuery);

    // 4. Product Count
    const Product = require("../models/Product");
    const productCount = await Product.countDocuments({
      ...query,
      isActive: true,
    });

    // 5. Recent Orders (for the dashboard table)
    const recentOrders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("customer");

    return res.status(200).json({
      success: true,
      data: {
        stats: [
          {
            label: "Нийт борлуулалт",
            value: `₮${totalSales.toLocaleString()}`,
            icon: "payments",
          },
          {
            label: "Амжилттай захиалга",
            value: orderCount.toString(),
            icon: "check_circle",
          },
          {
            label: "Хүлээгдэж буй",
            value: pendingOrdersCount.toString(),
            icon: "pending_actions",
            color: "amber",
          },
          {
            label: "Шинэ хэрэглэгч",
            value: newCustomersCount.toString(),
            icon: "group",
          },
        ],
        productCount: productCount.toString(),
        recentOrders: recentOrders.map((o) => ({
          _id: o._id,
          id: o._id.toString().substring(0, 8),
          customer: o.customer
            ? {
                name: o.customer.name,
                facebookId: o.customer.facebookId,
                avatar: o.customer.avatar,
              }
            : { name: "Тодорхойгүй" },
          items: o.items || [],
          totalAmount: o.totalAmount,
          paymentStatus: o.paymentStatus || "pending",
          paymentMethod: o.paymentMethod || "cash",
          hasDelivery: o.hasDelivery !== false,
          pickupAddress: o.pickupAddress || "",
          address: o.address || "",
          phone: o.phoneNumber || "",
          status: o.status,
          createdAt: o.createdAt,
          needsReview: o.aiExtraction?.needsReview || false,
        })),
      },
    });
  } catch (error) {
    console.error("❌ Stats Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
