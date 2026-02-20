const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true, // Allow multiple users with no email (null)
      trim: true,
      lowercase: true,
    },
    facebookId: {
      type: String,
      required: true,
      unique: true,
    },
    avatar: {
      type: String,
    },
    facebookPageToken: {
      type: String,
      trim: true,
    },
    openAiKey: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ["admin", "staff"],
      default: "admin",
    },
    lastLogin: {
      type: Date,
      default: Date.now,
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

const User = mongoose.model("User", userSchema);
module.exports = User;
