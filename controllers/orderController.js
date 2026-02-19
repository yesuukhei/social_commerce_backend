const Order = require("../models/Order");
const Customer = require("../models/Customer");
const Product = require("../models/Product");
const Store = require("../models/Store");
const googleSheetsService = require("../services/googleSheetsService");

/**
 * Get all orders
 * GET /api/orders
 */
exports.getAllOrders = async (req, res, next) => {
  try {
    const { status, customerId, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (customerId) query.customer = customerId;

    const orders = await Order.find(query)
      .populate("customer", "name facebookId")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const count = await Order.countDocuments(query);

    res.json({
      orders,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalOrders: count,
    });
  } catch (error) {
    console.log("Error in getAllOrders:", error);
    next(error);
  }
};

/**
 * Get single order by ID
 * GET /api/orders/:id
 */
exports.getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customer")
      .populate("conversation");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json(order);
  } catch (error) {
    console.log("Error in getOrderById:", error);
    next(error);
  }
};

/**
 * Update order status
 * PATCH /api/orders/:id/status
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true },
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json(order);
  } catch (error) {
    console.log("Error in updateOrderStatus:", error);
    next(error);
  }
};

/**
 * Verify/Review order (Update data and status)
 * PATCH /api/orders/:id/verify
 */
exports.verifyOrder = async (req, res, next) => {
  try {
    const { items, phoneNumber, address, status, notes } = req.body;

    const updateData = {
      verifiedAt: new Date(),
      "aiExtraction.needsReview": false,
    };

    if (items) updateData.items = items;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (address) updateData.address = address;
    if (status) updateData.status = status;
    if (notes) updateData.notes = notes;

    const order = await Order.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json(order);
  } catch (error) {
    console.log("Error in verifyOrder:", error);
    next(error);
  }
};

/**
 * Delete order
 * DELETE /api/orders/:id
 */
exports.deleteOrder = async (req, res, next) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json({ message: "Order deleted successfully" });
  } catch (error) {
    console.log("Error in deleteOrder:", error);
    next(error);
  }
};

/**
 * Approve and fulfill order
 * POST /api/orders/:id/approve
 */
exports.approveOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate("customer");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.status === "completed") {
      return res.status(400).json({ message: "Order is already approved" });
    }

    const store = await Store.findById(order.store);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    // 1. Inventory Check & Reduction
    for (const item of order.items) {
      const product = await Product.findOne({
        store: store._id,
        name: item.itemName,
      });

      if (product) {
        if (product.stock < item.quantity) {
          return res.status(400).json({
            message: `"${product.name}" барааны үлдэгдэл хүрэлцэхгүй байна (Үлдэгдэл: ${product.stock})`,
          });
        }
        product.stock -= item.quantity;
        await product.save();

        // Sync back to Google Sheets
        await googleSheetsService.updateProductStock(
          store.googleSheetId,
          product.name,
          product.stock,
        );
      }
    }

    // 2. Sync to Google Sheets (New Row)
    await googleSheetsService.appendOrder(order, store.googleSheetId);

    // 3. Update Status
    order.status = "completed";
    order.verifiedAt = new Date();
    await order.save();

    res.json({
      success: true,
      message: "Захиалга амжилттай баталгаажлаа",
      order,
    });
  } catch (error) {
    console.error("❌ Error in approveOrder:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
