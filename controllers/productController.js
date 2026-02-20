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
    const filter = {};

    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (store) filter.store = store;
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

    // Fetch store info for dynamic headers/mapping
    const Store = require("../models/Store");
    let storeDoc = await Store.findOne({ user: req.user._id });

    // Fallback for MVP/Testing if no user mapping yet
    if (!storeDoc) {
      storeDoc = await Store.findOne();
    }

    res.json({
      success: true,
      count: products.length,
      data: products,
      meta: {
        headers: storeDoc?.sheetHeaders || [],
        mapping: storeDoc?.columnMapping || {},
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
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
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
