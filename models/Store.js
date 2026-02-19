const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Facebook Integration
    facebookPageId: {
      type: String,
      required: true,
      unique: true,
    },
    facebookPageToken: {
      type: String,
      required: true,
    },
    // Google Sheets Integration
    googleSheetId: {
      type: String,
    },
    // The "Soul" of the AI
    customInstructions: {
      type: String,
      default: "Чи бол найрсаг туслах бот юм.",
    },
    // AI Feature Settings
    columnMapping: {
      name: { type: String, default: "" },
      price: { type: String, default: "" },
      stock: { type: String, default: "" },
      category: { type: String, default: "" },
      description: { type: String, default: "" },
    },
    // Currency & Locale
    settings: {
      currency: { type: String, default: "MNT" },
      timezone: { type: String, default: "Asia/Ulaanbaatar" },
    },
    // Delivery & Pickup Settings
    hasDelivery: {
      type: Boolean,
      default: true,
    },
    pickupAddress: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

const Store = mongoose.model("Store", storeSchema);
module.exports = Store;
