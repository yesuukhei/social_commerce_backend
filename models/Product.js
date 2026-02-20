const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    images: [String],
    // Dynamic attributes from unconventional sheet columns
    attributes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

// Search index
productSchema.index({ name: "text", description: "text" });

const Product = mongoose.model("Product", productSchema);
module.exports = Product;
