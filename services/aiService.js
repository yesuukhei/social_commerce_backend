const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Senior Software Engineer Perspective: Modular context builders
 * These keep the main logic clean and reusable.
 */
const buildCatalogContext = (catalog = []) => {
  if (!catalog.length) return "Одоогоор бараа байхгүй байна.";
  return catalog
    .map((p) => {
      const attrs = p.attributes
        ? Object.entries(p.attributes)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "";
      return `- ${p.name}: ₮${p.price.toLocaleString()} (Үлдэгдэл: ${p.stock}) ${attrs ? `[${attrs}]` : ""} ${p.category ? `[Type: ${p.category}]` : ""}`;
    })
    .join("\n");
};

const buildHistoryContext = (history = []) => {
  return history
    .map((h) => `${h.sender === "customer" ? "User" : "Bot"}: ${h.text}`)
    .join("\n");
};

const buildBusinessRulesContext = (settings = {}) => {
  const delivery = settings.hasDelivery
    ? `ХҮРГЭЛТ: Тийм (Үнэ: ₮${(settings.deliveryFee || 0).toLocaleString()}, Хугацаа: ${settings.deliveryTime || "Тодорхойгүй"})`
    : `ХҮРГЭЛТ: Үгүй (Очиж авах хаяг: ${settings.pickupAddress || "Тодорхойгүй"})`;

  let payment = "";
  if (settings.paymentMethod === "manual" || !settings.paymentMethod) {
    const bank = settings.paymentDetails;
    payment = `ТӨЛБӨР (Дансаар): ${bank?.bankName || ""} [${bank?.accountNumber || ""}]${bank?.iban ? ` (IBAN: ${bank.iban})` : ""} - ${bank?.accountHolder || ""}\n!!! ЧУХАЛ: Гүйлгээний утга дээр УТАСНЫ ДУГААРАА заавал бичихийг сануул !!!`;
  } else if (settings.paymentMethod === "cash") {
    payment = `ТӨЛБӨР: Бэлнээр (Хүргэлтээр очих үед эсвэл очиж авахдаа бэлнээр төлж болно).`;
  } else {
    payment = `ТӨЛБӨР: Тодорхойгүй.`;
  }

  return `${delivery}\n${payment}`;
};

/**
 * Senior Product & UX Perspective:
 * The AI should have a "Soul" (personality) and a "Brain" (extraction).
 */
exports.processMessage = async (
  messageText,
  history = [],
  catalog = [],
  storeSettings = {},
  orderHistory = [],
  conversationStatus = "active",
) => {
  try {
    const catalogData = buildCatalogContext(catalog);
    const convoHistory = buildHistoryContext(history);

    const systemPrompt = `
Чи бол Монголын онлайн дэлгүүрийн ухаалаг туслах юм.
ЗАН ТӨЛӨВ: ${storeSettings.customInstructions || "Найрсаг, тусламтгай."}
ОДООГИЙН ХАРИЛЦААНЫ ТӨЛӨВ: "${conversationStatus}"
(Хэрэв төлөв "order_created" байвал саяхан захиалга үүссэн гэсэн үг. Хэрэглэгч зүгээр л "за", "баярлалаа" гэвэл "ordering" биш "other" эсвэл "order_status" гэж ойлгож, дахин шинэ захиалга БҮҮ үүсгэ!)

ҮҮРЭГ: Хэрэглэгчийн мессежнээс Intent болон Data-г задлан авч JSON-оор хариул.

КАТАЛОГ:
${catalogData}

ЗАХИАЛГЫН ТҮҮХ:
${orderHistory.map((o) => `- ID: ${o._id.toString().slice(-4)}, Status: ${o.status}`).join("\n") || "Байхгүй"}

БИЗНЕС ДҮРЭМ:
${buildBusinessRulesContext(storeSettings)}

JSON БҮТЭЦ:
{
  "intent": "browsing" | "inquiry" | "ordering" | "order_status",
  "isOrderReady": boolean, (Хэрэв data дотор барааны нэр/тоо, утас${storeSettings.hasDelivery !== false ? ", хаяг (дүүрэг байсан ч болно)" : ""} бүгд байвал заавал true болго),
  "data": {
    "items": [{ "name": string, "quantity": number, "price": number }],
    "phone": string,
    "full_address": string
  },
  "missingFields": string[],
  "confidence": number (0-1 хооронд)
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `History: \n${convoHistory}\nMessage: ${messageText}`,
        },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error("❌ AI Process Error:", error);
    return {
      intent: "browsing",
      isOrderReady: false,
      data: { items: [] },
      missingFields: [],
    };
  }
};

/**
 * Senior UX Perspective:
 * Natural language generation that feels human and helpful.
 */
exports.generateResponse = async (
  aiResult,
  userMessage,
  storeSettings = {},
  order = null,
) => {
  try {
    const orderConf = order
      ? `Захиалга баталгаажсан: ₮${order.totalAmount.toLocaleString()}, Утас: ${order.phoneNumber}`
      : "";

    const systemPrompt = `
Чи бол Монгол хүн шиг ярьдаг найрсаг туслах.
ЗАН ТӨЛӨВ: ${storeSettings.customInstructions || "Эелдэг."}

ДҮРЭМ:
1. Захиалга баталгаажсан бол (Data: ${orderConf}) баярлалаа гээд дүнг нь хэл.
2. Мэдээлэл дутуу бол (@missingFields: ${aiResult.missingFields?.join(", ")}) эелдэгээр асуу.
3. Бараа дууссан бол catalog үзээд өөр зүйл санал болго.
4. Хүргэлт болон төлбөрийн мэдээллийг дараах дүрмийн дагуу өг:
${buildBusinessRulesContext(storeSettings)}
5. Хэтэрхий "Робот" шиг битгий ярь.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `AI Analysis: ${JSON.stringify(aiResult)}\nMessage: ${userMessage}`,
        },
      ],
      temperature: 0.7,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    return "Уучлаарай, түр хүлээгээрэй. 😊";
  }
};

/**
 * Utility functions for data sanitation
 */
exports.validatePhoneNumber = (phone) => {
  const cleaned = (phone || "").replace(/\D/g, "");
  return cleaned.length === 8 && /^[6-9]\d{7}$/.test(cleaned);
};

exports.mapSheetHeaders = async (headers, sampleRows) => {
  try {
    const prompt = `Map these sheet headers to: name, price, stock.
Headers: ${JSON.stringify(headers)}
Samples: ${JSON.stringify(sampleRows)}
Return JSON: { "mapping": { "standard_key": "sheet_header" }, "confidence": number }`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    return { mapping: {}, confidence: 0 };
  }
};
