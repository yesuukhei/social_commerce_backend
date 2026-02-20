const { Order, Customer } = require("../models");

/**
 * Get store statistics
 * GET /api/stats
 */
exports.getStats = async (req, res) => {
  try {
    const { storeId } = req.query;

    // For MVP, if no storeId, use the first one
    let query = {};
    if (storeId) {
      query.store = storeId;
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

    // 3. New Customers (Last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newCustomersCount = await Customer.countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
    });

    // 4. Recent Orders (for the dashboard table)
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
            trend: 12.5,
          },
          {
            label: "Амжилттай захиалга",
            value: orderCount.toString(),
            icon: "check_circle",
            trend: 8.2,
          },
          {
            label: "Хүлээгдэж буй",
            value: pendingOrdersCount.toString(),
            icon: "pending_actions",
            trend: 0,
            color: "amber",
          },
          {
            label: "Шинэ хэрэглэгч",
            value: newCustomersCount.toString(),
            icon: "group",
            trend: 5.4,
          },
        ],
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
