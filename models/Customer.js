const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    facebookId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      index: { sparse: true },
    },
    address: {
      type: String,
    },
    // Order history reference
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    // Customer metadata
    metadata: {
      firstMessageDate: {
        type: Date,
        default: Date.now,
      },
      lastMessageDate: {
        type: Date,
        default: Date.now,
      },
      totalOrders: {
        type: Number,
        default: 0,
      },
      totalSpent: {
        type: Number,
        default: 0,
      },
    },
    // Customer preferences
    preferences: {
      language: {
        type: String,
        default: "mn",
      },
      notifications: {
        type: Boolean,
        default: true,
      },
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

// Index for faster queries
// phoneNumber index is automatically created by 'sparse: true' if we add index: true
customerSchema.index({ "metadata.lastMessageDate": -1 });

// Update last message date on save
customerSchema.pre("save", function (next) {
  this.metadata.lastMessageDate = new Date();
  next();
});

const Customer = mongoose.model("Customer", customerSchema);

module.exports = Customer;
