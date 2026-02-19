const axios = require("axios");
const jwt = require("jsonwebtoken");
const { User } = require("../models");

/**
 * Facebook Login / Register
 * POST /api/auth/facebook
 */
exports.facebookLogin = async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res
        .status(400)
        .json({ success: false, message: "Facebook access token is required" });
    }

    // 1. Verify token with Facebook Graph API
    const fbResponse = await axios.get(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`,
    );

    const { id: facebookId, name, email, picture } = fbResponse.data;

    if (!facebookId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Facebook token" });
    }

    // 2. Find or Create User
    let user = await User.findOne({ facebookId });

    if (!user) {
      user = await User.create({
        facebookId,
        name,
        email,
        avatar: picture?.data?.url,
        role: "admin", // First user or specific logic for admin assignment
      });
      console.log(`🆕 New Admin Registered: ${name}`);
    } else {
      // Update last login
      user.lastLogin = new Date();
      if (picture?.data?.url) user.avatar = picture.data.url;
      await user.save();
    }

    // 3. Generate JWT Token for our app
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET || "your_super_secret_jwt_key_123",
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(
      "❌ Facebook Login Error:",
      error.response?.data || error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Authentication failed",
      error: error.response?.data?.error?.message || error.message,
    });
  }
};

/**
 * Get current user profile
 * GET /api/auth/me
 */
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -__v");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
