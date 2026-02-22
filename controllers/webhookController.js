const messengerService = require("../services/messengerService");
const aiService = require("../services/aiService");
const googleSheetsService = require("../services/googleSheetsService");
const paymentService = require("../services/paymentService");
const { getIO } = require("../utils/socket");

/**
 * Webhook Verification (GET request from Facebook)
 * Facebook will call this endpoint to verify your webhook
 */
exports.verifyWebhook = (req, res) => {
  const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;

  // Parse params from the webhook verification request
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Check if a token and mode were sent
  if (mode && token) {
    // Check the mode and token sent are correct
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      // Respond with 200 OK and challenge token from the request
      console.log("✅ Webhook verified successfully!");
      res.status(200).send(challenge);
    } else {
      // Responds with '403 Forbidden' if verify tokens do not match
      console.error("❌ Webhook verification failed - Invalid token");
      res.sendStatus(403);
    }
  } else {
    console.error("❌ Webhook verification failed - Missing parameters");
    res.sendStatus(400);
  }
};

const { Store, Product, Customer, Conversation, Order } = require("../models");

/**
 * Handle Incoming Messages (POST request from Facebook)
 * This is called when a customer sends a message
 */
exports.handleWebhook = async (req, res) => {
  const body = req.body;

  if (body.object === "page" || body.object === "instagram") {
    res.status(200).send("EVENT_RECEIVED");

    try {
      await Promise.all(
        body.entry.map(async (entry) => {
          const sourceId = entry.id; // FB Page ID or IG Business ID
          const webhookEvent = entry.messaging[0];
          const senderPsid = webhookEvent.sender.id;

          console.log(
            `📨 Message from ${body.object}: ${sourceId} from Sender: ${senderPsid}`,
          );

          // 1. Find Store by FB Page ID OR Instagram Business ID
          let store = await Store.findOne({
            $or: [
              { facebookPageId: sourceId },
              { instagramBusinessId: sourceId },
            ],
          });

          if (!store) {
            console.error(
              `❌ Store not found for ${body.object} ID: ${sourceId}`,
            );
            return;
          }

          // 2. Load Catalog (Products)
          const catalog = await Product.find({
            store: store._id,
            isActive: true,
          });

          // 3. Process Event
          if (webhookEvent.message) {
            await handleMessage(
              senderPsid,
              webhookEvent.message,
              store,
              catalog,
            );
          } else if (webhookEvent.postback) {
            await handlePostback(
              senderPsid,
              webhookEvent.postback,
              store,
              catalog,
            );
          }
        }),
      );
    } catch (error) {
      console.error("❌ Error processing entries:", error);
    }
  } else {
    res.sendStatus(404);
  }
};

/**
 * Handle incoming text messages
 */
async function handleMessage(senderPsid, receivedMessage, store, catalog) {
  try {
    let response;

    if (receivedMessage.text) {
      const messageText = receivedMessage.text;
      console.log(`💬 Message [${store.name}]: ${messageText}`);

      // Find or create customer
      const customer = await findOrCreateCustomer(senderPsid, store);

      // Find or create conversation — always scoped to the current store
      let conversation = await Conversation.findOne({
        facebookConversationId: senderPsid,
        store: store._id,
      });

      if (!conversation) {
        conversation = new Conversation({
          customer: customer._id,
          store: store._id,
          facebookConversationId: senderPsid,
          currentIntent: "browsing",
        });
      }

      const history = conversation.messages.slice(-5);
      const newCustMsg = await conversation.addMessage("customer", messageText);

      // Real-time Update
      const io = getIO();
      io.to(conversation._id.toString()).emit("new-message", newCustMsg);
      io.emit("conversation-updated", {
        conversationId: conversation._id,
        lastMessage: messageText,
        lastActivity: new Date(),
      });

      // Senior UX: If manual mode is ON, we don't let AI respond
      if (conversation.isManualMode) {
        console.log(`👤 Manual Mode is ON for ${senderPsid}. AI skipping...`);
        return;
      }

      await messengerService.sendTypingIndicator(
        senderPsid,
        true,
        store.facebookPageToken,
      );

      // 1. Fetch Customer Order History (to allow context-aware responses)
      const orderHistory = await Order.find({
        customer: customer._id,
        store: store._id,
      })
        .sort({ createdAt: -1 })
        .limit(3);

      // 2. Process message with Unified AI, Catalog, and DB History
      const aiResult = await aiService.processMessage(
        messageText,
        history,
        catalog,
        store,
        orderHistory,
        conversation.status,
      );
      console.log(
        `🤖 AI Analysis [${store.name}]:`,
        JSON.stringify(aiResult, null, 2),
      );

      conversation.currentIntent = aiResult.intent || "browsing";

      // Safety check: if delivery is disabled, NEVER ask for an address
      if (store.hasDelivery === false) {
        if (Array.isArray(aiResult.missingFields)) {
          aiResult.missingFields = aiResult.missingFields.filter(
            (f) => !f.includes("хаяг") && !f.includes("address"),
          );
        }
        if (aiResult.data) {
          delete aiResult.data.full_address;
        }
      }

      // Safety check: if AI extracted all data but forgot to set isOrderReady to true
      if (aiResult.intent === "ordering" && !aiResult.isOrderReady) {
        const hasItems = aiResult.data?.items?.length > 0;
        const hasPhone = !!aiResult.data?.phone;
        const needsAddress = store.hasDelivery !== false;
        const hasAddress = !!aiResult.data?.full_address;
        const allFieldsPresent =
          hasItems && hasPhone && (!needsAddress || hasAddress);

        if (allFieldsPresent) {
          console.log(
            `⚡ Safety override: forcing isOrderReady=true (AI had all data)`,
          );
          aiResult.isOrderReady = true;
        }
      }

      if (
        aiResult.intent === "ordering" &&
        aiResult.isOrderReady &&
        (aiResult.confidence || 1) > 0.6
      ) {
        // ─── CATALOG VALIDATION & PRICE AUTO-FILL ───────────────────────
        const validatedItems = [];
        const unknownItems = [];

        for (const item of aiResult.data.items) {
          // Fuzzy match: find catalog product whose name overlaps with AI-extracted name
          const match = catalog.find((p) => {
            const catalogName = p.name.toLowerCase();
            const aiName = (item.name || "").toLowerCase();
            return (
              catalogName.includes(aiName) ||
              aiName.includes(catalogName) ||
              aiName
                .split(" ")
                .some((word) => word.length > 2 && catalogName.includes(word))
            );
          });

          if (!match) {
            unknownItems.push(item.name);
          } else {
            validatedItems.push({
              itemName: match.name, // Use canonical catalog name
              quantity: item.quantity || 1,
              price: match.price, // Always use catalog price — never trust AI price
              productId: match._id,
              attributes: item.attributes || {},
            });
          }
        }

        if (unknownItems.length > 0) {
          // AI hallucinated a product not in catalog — abort order, ask AI to respond
          console.log(
            `⚠️  Unknown items (not in catalog): ${unknownItems.join(", ")}`,
          );
          aiResult.isOrderReady = false;
          aiResult.missingFields = [
            `Каталогд байхгүй бараа: ${unknownItems.join(", ")}`,
          ];

          const replyText = await aiService.generateResponse(
            aiResult,
            messageText,
            store,
            null,
            catalog,
          );
          response = { text: replyText };
          conversation.status = "active";
          await conversation.save();

          await messengerService.sendTypingIndicator(
            senderPsid,
            false,
            store.facebookPageToken,
          );
          await messengerService.sendMessage(
            senderPsid,
            response,
            store.facebookPageToken,
          );
          return;
        }
        // ─────────────────────────────────────────────────────────────────

        const orderData = {
          store: store._id,
          customer: customer._id,
          conversation: conversation._id,
          phoneNumber: aiResult.data.phone || "99999999",
          address: store.hasDelivery
            ? aiResult.data.full_address || "Хаяг тодорхойгүй"
            : "Очиж авах",
          hasDelivery: store.hasDelivery,
          pickupAddress: store.pickupAddress,
          items: validatedItems,
          totalAmount: 0,
          aiExtraction: {
            rawMessage: messageText,
            extractedData: aiResult.data,
            confidence: aiResult.confidence,
            needsReview:
              !aiResult.data.phone ||
              (store.hasDelivery !== false && !aiResult.data.full_address),
          },
          paymentMethod: store.paymentMethod || "manual",
          status: "pending",
        };

        const order = new Order(orderData);

        // Нарийвчлан мөнгөн дүнг тооцоолох (Invoice үүсгэхээс өмнө)
        if (order.items && order.items.length > 0) {
          order.totalAmount = order.items.reduce((total, item) => {
            const subtotal = (item.price || 0) * item.quantity;
            item.subtotal = subtotal;
            return total + subtotal;
          }, 0);
        }

        await order.save();

        // Real-time Notification for Admin
        io.emit("order-created", {
          orderId: order._id,
          customerName: customer.name,
          totalAmount: order.totalAmount,
          storeId: store._id,
          storeName: store.name,
        });

        // Link order to conversation for UI recap
        conversation.orders.push(order._id);
        console.log(`✅ Order Draft created for ${store.name}: ${order._id}`);

        // Pass the saved 'order' to generate a detailed confirmation
        const replyText = await aiService.generateResponse(
          aiResult,
          messageText,
          store,
          order,
          catalog,
        );
        response = { text: replyText };
        conversation.status = "order_created";
      } else {
        const replyText = await aiService.generateResponse(
          aiResult,
          messageText,
          store,
          null,
          catalog,
        );
        response = { text: replyText };

        if (aiResult.intent === "ordering" && !aiResult.isOrderReady) {
          conversation.status = "waiting_for_info";
        }
      }

      await conversation.save();
      const newBotMsg = await conversation.addMessage("bot", response.text);

      // Real-time Update
      io.to(conversation._id.toString()).emit("new-message", newBotMsg);
      io.emit("conversation-updated", {
        conversationId: conversation._id,
        lastMessage: response.text,
        lastActivity: new Date(),
        status: conversation.status,
        storeId: store._id,
      });
      await messengerService.sendTypingIndicator(
        senderPsid,
        false,
        store.facebookPageToken,
      );
      await messengerService.sendMessage(
        senderPsid,
        response,
        store.facebookPageToken,
      );
    } else if (receivedMessage.attachments) {
      response = {
        text: "📷 Зураг хүлээн авлаа! Захиалгын мэдээллээ текстээр илгээнэ үү.",
      };
      await messengerService.sendMessage(
        senderPsid,
        response,
        store.facebookPageToken,
      );
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
    try {
      await messengerService.sendMessage(
        senderPsid,
        {
          text: "😔 Уучлаарай, алдаа гарлаа. Дахин оролдоно уу.",
        },
        store.facebookPageToken,
      );
    } catch (sendError) {}
  }
}

/**
 * Handle postback events
 */
async function handlePostback(senderPsid, receivedPostback, store, catalog) {
  try {
    const payload = receivedPostback.payload;
    let response;

    switch (payload) {
      case "GET_STARTED":
        response = {
          text: `👋 Тавтай морил! Би ${store.name}-ийн туслах бот байна.`,
        };
        break;
      default:
        response = { text: "Тодорхойгүй команд байна." };
    }

    await messengerService.sendMessage(
      senderPsid,
      response,
      store.facebookPageToken,
    );
  } catch (error) {
    console.error("❌ Error handling postback:", error);
  }
}

/**
 * Find or create customer
 */
async function findOrCreateCustomer(facebookId, store) {
  try {
    let customer = await Customer.findOne({ facebookId });

    if (!customer) {
      const userInfo = await messengerService.getUserInfo(
        facebookId,
        store.facebookPageToken,
      );
      customer = new Customer({
        facebookId,
        name: userInfo.name || "Unknown User",
      });
      await customer.save();
    }
    return customer;
  } catch (error) {
    console.error("❌ Error finding/creating customer:", error);
    throw error;
  }
}
