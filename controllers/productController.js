const { Product } = require("../models");

/**
 * GET /api/products
 * List all products
 */
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

exports.getAllProducts = async (req, res) => {
  try {
    const { category, isActive, store, search, minPrice, maxPrice } = req.query;

    // 1. Get all stores owned by this user
    const Store = require("../models/Store");
    const userStores = await Store.find({ user: req.user._id }).select(
      "_id sheetHeaders columnMapping",
    );
    const storeIds = userStores.map((s) => s._id);

    if (storeIds.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: [],
        meta: { headers: [], mapping: {} },
      });
    }

    const filter = { store: { $in: storeIds } };

    // If specific store requested, verify ownership
    if (store && storeIds.some((id) => id.toString() === store)) {
      filter.store = store;
    }

    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (search) {
      const escapedSearch = escapeRegex(search);
      filter.$or = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { description: { $regex: escapedSearch, $options: "i" } },
      ];
    }
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    const products = await Product.find(filter).sort({ createdAt: 1 });

    // Identify which store to get headers from (requested store or first one)
    const targetStore = store
      ? userStores.find((s) => s._id.toString() === store)
      : userStores[0];

    res.json({
      success: true,
      count: products.length,
      data: products,
      meta: {
        headers: targetStore?.sheetHeaders || [],
        mapping: targetStore?.columnMapping || {},
      },
    });
  } catch (error) {
    console.error("❌ Get Products Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * GET /api/products/:id
 * Get single product details
 */
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate("store");
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Security Check
    if (product.store?.user?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("❌ Get Product Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
