/**
 * Payment Service
 * Handles QPay and other payment integrations
 */
exports.createQPayInvoice = async (order) => {
  try {
    // In production, this would call QPay API to get an invoice and QR code
    // For MVP/Demo, we simulate a successful invoice creation

    console.log(
      `💰 Generating QPay Invoice for Order: ${order._id} (Amount: ₮${order.totalAmount})`,
    );

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      success: true,
      data: {
        invoiceId: `INV-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        qrCode: "SIMULATED_QR_CODE_DATA", // This would be the actual image data or link
        urls: [
          { name: "Khan Bank", link: "khanbank://..." },
          { name: "State Bank", link: "statebank://..." },
        ],
      },
    };
  } catch (error) {
    console.error("❌ QPay Invoice Creation Error:", error);
    return { success: false, message: error.message };
  }
};

/**
 * Check payment status (Polling or Callback)
 */
exports.checkPaymentStatus = async (invoiceId) => {
  // Simulate payment check
  return { paid: Math.random() > 0.7 }; // 30% chance it's paid for demo purposes
};
