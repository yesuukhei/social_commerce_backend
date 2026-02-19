const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");

const { protect } = require("../middleware/auth");

// All routes here are prefixed with /api/orders in server.js
router.use(protect);

router.get("/", orderController.getAllOrders);
router.get("/:id", orderController.getOrderById);
router.patch("/:id/status", orderController.updateOrderStatus);
router.patch("/:id/verify", orderController.verifyOrder);
router.post("/:id/approve", orderController.approveOrder);
router.delete("/:id", orderController.deleteOrder);

module.exports = router;
