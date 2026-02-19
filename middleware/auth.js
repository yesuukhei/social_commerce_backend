const jwt = require("jsonwebtoken");
const { User } = require("../models");

/**
 * Protect routes - ensures user is logged in
 */
exports.protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Нэвтрэх шаардлагатай",
      });
    }

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your_super_secret_jwt_key_123",
    );

    // Check if user still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Хэрэглэгч олдсонгүй",
      });
    }

    // Grant access
    req.user = user;
    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Токен хүчингүй байна",
    });
  }
};

/**
 * Restrict to certain roles
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Энэ үйлдлийг хийх эрхгүй байна",
      });
    }
    next();
  };
};
