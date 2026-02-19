const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Unified AI service to process text messages
 * Detects intent, extracts order info, and generates response context in one call
 * @param {string} messageText - Customer's message
 * @param {Array} history - Brief conversation history for context
 * @param {Array} catalog - Available products for this store
 * @param {object} storeSettings - Store configuration
 * @param {Array} orderHistory - Customer's past orders from database
 * @returns {object} Extracted data and response logic
 */
exports.processMessage = async (
  messageText,
  history = [],
  catalog = [],
  storeSettings = {},
  orderHistory = [],
) => {
  try {
    const formattedHistory = history
      .map((h) => `${h.sender === "customer" ? "User" : "Bot"}: ${h.text}`)
      .join("\n");

    const catalogContext =
      catalog.length > 0
        ? `ДЭЛГҮҮРИЙН БАРААНЫ ЖАГСААЛТ:\n${catalog
            .map((p) => {
              let attrStr = "";
              if (p.attributes && p.attributes instanceof Map) {
                const attrs = [];
                for (const [key, value] of p.attributes.entries()) {
                  attrs.push(`${key}: ${value}`);
                }
                if (attrs.length > 0) attrStr = ` [${attrs.join(", ")}]`;
              }
              const desc = p.description ? ` - Тайлбар: ${p.description}` : "";
              const cat = p.category ? ` [Төрөл: ${p.category}]` : "";
              return `- ${p.name}${cat}: ₮${p.price} (Үлдэгдэл: ${p.stock})${attrStr}${desc}`;
            })
            .join("\n")}`
        : "АНХААР: Одоогоор дэлгүүрт бэлэн бараа байхгүй байна. Хэрэглэгчид удахгүй шинэ бараа ирнэ гэж эелдэгээр хэлээрэй.";

    const systemPrompt = `Чи бол Монголын онлайн дэлгүүрийн ухаалаг туслах бот.
ҮҮРЭГ: Хэрэглэгчийн мессежнээс зорилго болон захиалгын мэдээллийг задлан шинжлэх.

${catalogContext}

ЗОРИЛГО ТОДОРХОЙЛОХ (Intent):
1. 'browsing' -> Хэрэглэгч "сайн уу", "юу байна", "юу зардаг вэ", "санал болго" гэх мэтээр зөвхөн сонирхож байвал.
2. 'inquiry' -> Тодорхой бараа асуусан боловч (байгаа юу, үнэ хэд вэ) авах эсэх нь тодорхойгүй байвал.
3. 'ordering' -> "Авъя", "Захиалъя", "Нэгийг бичээрэй" гэх мэтээр худалдан авах шийдвэр гаргасан эсвэл хаяг, утсаа бичсэн бол.
4. 'order_status' -> Хэрэглэгч өөрийн захиалга, төлбөр, хүргэлтийн төлөв эсвэл захиалгын түүхээ асууж байвал.

ХЭРЭГЛЭГЧИЙН ЗАХИАЛГЫН ТҮҮХ (DATABASE):
${
  orderHistory.length > 0
    ? orderHistory
        .map(
          (o) =>
            `- ID: ${o._id.toString().slice(-4)}, Төлөв: ${o.status}, Төлбөр: ${o.paymentStatus}, Дүн: ₮${o.totalAmount}, Огноо: ${o.createdAt}`,
        )
        .join("\n")
    : "АНХААР: Энэ хэрэглэгчид одоогоор ямар нэгэн захиалгын түүх байхгүй байна."
}

ДҮРЭМ (Rules):
1. ЛАТИН ГАЛИГ: Латин галигаар бичсэн бол кирилл рүү хөрвүүлж ойлго.
2. БАРААНЫ ҮЛДЭГДЭЛ (Stock Check):
   - Хэрэв барааны үлдэгдэл (stock) 0 байвал 'ordering' гэж ТЭМДЭГЛЭЖ БОЛОХГҮЙ. Үүнийг 'inquiry' болгож өөрчил.
   - Хэрэглэгчид "Уучлаарай, энэ бараа дууссан байна" гэж хэлээд 'alternative_items' санал болго.
   - Хэрэв хэрэглэгч үлдэгдлээс их хэмжээгээр захиалахыг хүсвэл (жишээ нь: үлдэгдэл 2 байхад 5-ыг), зөвхөн байгаа хэмжээгээр нь захиалахыг санал болго.
3. ХАЯГ: Дүүрэг, Хороог бүтэн нэршил рүү хөрвүүл.

ШИЙДВЭР ГАРГАЛТ (isOrderReady):
- Зөвхөн 'intent' : 'ordering' үед (Бараа + Утас + Хаяг) бүрэн байвал 'isOrderReady' : true болно.
- Хэрэв бараа дууссан (stock: 0) бол 'isOrderReady' үргэлж FALSE байна.
- Бусад тохиолдолд (browsing, inquiry) үргэлж 'isOrderReady' : false байна.

ДЭЛГҮҮРИЙН ХҮРГЭЛТИЙН ТОХИРГОО:
- Хүргэлт хийдэг үү: ${storeSettings.hasDelivery ? "ТИЙМ" : "ҮГҮЙ (Зөвхөн очиж авах)"}
- Очиж авах хаяг: ${storeSettings.pickupAddress || "Тодорхойгүй"}

ЧУХАЛ: 
${
  storeSettings.hasDelivery
    ? "- 'full_address' талбар ЗААВАЛ байх ёстой."
    : "- Энэ дэлгүүр ХҮРГЭЛТГҮЙ тул 'full_address' шаардахгүй. Хэрэглэгчээс хаяг битгий асуу. Харин 'pickup' гэдгийг ойлгуул."
}

JSON БҮТЭЦ:
{
  "intent": "browsing | inquiry | ordering",
  "isOrderReady": true/false,
  "confidence": number,
  "data": {
    "items": [{ "name": string, "quantity": number, "price": number, "attributes": object }],
    "alternative_items": [string], (Манай каталог-д байгаа бараануудаас)
    "phone": string,
    "full_address": string,
    "payment_method": string
  },
  "missingFields": ["phone", "full_address", "items"] (Хүргэлтгүй дэлгүүр бол "full_address"-ийг энд бүү оруул)
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `Өмнөх яриа:\n${formattedHistory}\n\nШинэ мессеж: ${messageText}`,
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content);

    console.log("🤖 AI Processed:", {
      intent: result.intent,
      isOrder: result.isOrderReady,
      confidence: result.confidence,
    });

    return result;
  } catch (error) {
    console.error("❌ Error in AI processing:", error);
    return {
      intent: "other",
      isOrderReady: false,
      confidence: 0,
      data: { items: [], phone: null, full_address: null },
      missingFields: ["items"],
    };
  }
};

/**
 * Generate a friendly response in Mongolian
 * @param {object} aiResult - Result from processMessage
 * @param {string} userMessage - User's original message
 * @param {object} order - Optional created order object for confirmation
 * @returns {string} Generated response
 */
exports.generateResponse = async (aiResult, userMessage, order = null) => {
  try {
    const orderContext = order
      ? `ЗАХИАЛГА БАТАЛГААЖЛАА:
          Дүн: ₮${order.totalAmount.toLocaleString()}
          Бараанууд: ${order.items.map((i) => `${i.itemName} x ${i.quantity}`).join(", ")}
          Утас: ${order.phoneNumber}
          Хаяг: ${order.address}
          Төлбөр: ${order.paymentDetails?.invoiceId ? "QPay нэхэмжлэх үүссэн" : "Бэлнээр"}`
      : "";

    const systemPrompt = `Чи бол Монголын онлайн дэлгүүрийн найрсаг туслах бот.
AI-ийн задалсан үр дүнд (AI Result) тулгуурлан хэрэглэгчид товч бөгөөд найрсаг хариулт өг.

${orderContext}

АНХААРАХ ДҮРЭМ:
1. Хэрэв ЗАХИАЛГА БАТАЛГААЖЛАА гэсэн контекст байвал: Баярлалаа гээд дээрх мэдээллийг жагсааж баталгаажуул. Нийт дүнг заавал хэл.
2. Хэрэв 'intent' : 'order_status' бол: Өгөгдсөн 'DATABASE'-ийн мэдээллийг ашиглан хэрэглэгчийн сүүлийн захиалгын төлөв (хүргэлт, төлбөр) -ийг маш тодорхой хариул.
3. ТӨЛБӨР: Хэрэв "QPay нэхэмжлэх үүссэн" бол хэрэглэгчид "Би танд QPay QR код илгээлээ, дурын банкны апп-аар уншуулан төлөх боломжтой" гэж хэлээрэй.
4. ${
      order && !order.hasDelivery
        ? "Энэ захиалга ОЧИЖ АВАХ (Pickup) тул 'pickupAddress' хаяг дээр бэлэн болохыг сануул."
        : ""
    }
5. Хэрэв 'intent' : 'browsing' бол: Юу ч битгий нэхээрэй. Зөвхөн мэндлээд, манайд ямар бараанууд байгааг танилцуул.
6. Хэрэв хэрэглэгч "санал болго" гэвэл: "ДЭЛГҮҮРИЙН БАРААНЫ ЖАГСААЛТ"-аас 2-3 барааг онцлон санал болгож, үнийг нь хэл.
...`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `AI Result: ${JSON.stringify(aiResult)}\nUser Message: ${userMessage}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("❌ Error generating response:", error);
    return "Уучлаарай, алдаа гарлаа. Дахин оролдоно уу.";
  }
};

/**
 * Validate phone number format (Mongolian)
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} True if valid
 */
exports.validatePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return false;
  const cleaned = phoneNumber.replace(/\D/g, "");
  return cleaned.length === 8 && /^[6-9]\d{7}$/.test(cleaned);
};

/**
 * Normalize phone number to standard format
 * @param {string} phoneNumber - Phone number to normalize
 * @returns {string} Normalized phone number
 */
exports.normalizePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return null;
  const cleaned = phoneNumber.replace(/\D/g, "");
  if (cleaned.length === 8) return cleaned;
  return null;
};

/**
 * AI-powered header mapping for arbitrary spreadsheets
 * @param {Array} headers - List of header strings from the sheet
 * @param {Array} sampleRows - List of first few rows for semantic context
 */
exports.mapSheetHeaders = async (headers, sampleRows) => {
  try {
    const prompt = `
ТАНЫ ДААЛГАВАР: Google Sheet-ийн тодорхойгүй багануудыг системийн стандартын багануудтай (name, price, stock, category, description) холбох (Mapping).

ӨГӨГДӨЛ:
1. Баганын нэрнүүд (Headers): ${JSON.stringify(headers)}
2. Жишээ утгууд (Sample Data): ${JSON.stringify(sampleRows)}

ДҮРЭМ:
- 'name': Барааны нэр эсвэл SKU байж болох багана (Жишээ: "Product", "Бараа", "Нэр")
- 'price': Барааны үнэ (Жишээ: "Amount", "Cost", "Price", "Үнэ")
- 'stock': Үлдэгдэл (Жишээ: "Qty", "Stock", "Үлдэгдэл", "Тоо")
- 'category': Төрөл (Жишээ: "Type", "Category", "Төрөл")
- 'description': Тайлбар (Жишээ: "Note", "Detail", "Тайлбар")

JSON БҮТЭЦТЭЙ ХАРИУ ӨГНӨ ҮҮ. Хэрэв олдохгүй бол null утга өг.
{
  "mapping": {
    "name": "олсон_баганын_нэр",
    "price": "олсон_баганын_нэр",
    "stock": "олсон_баганын_нэр",
    "category": "олсон_баганын_нэр",
    "description": "олсон_баганын_нэр"
  },
  "confidence": 0.0-1.0
}
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error("❌ AI Mapping Error:", error);
    return { mapping: {}, confidence: 0 };
  }
};
