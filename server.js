// server.js
// يستقبل حدث "إنشاء طلب" من شوبيفاي، يسحب رابط صورة البطاقة المخصصة (Cloudlift)
// ورقم هاتف العميل، ويرسلها عبر WhatsApp Cloud API كـ "مستند" لتفادي ضغط الصور.

import express from "express";
import crypto from "crypto";

const app = express();

// نحتاج الـ body الخام (raw) للتحقق من توقيع شوبيفاي (HMAC)
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const {
  SHOPIFY_WEBHOOK_SECRET, // من شوبيفاي: Settings > Notifications > Webhooks
  WHATSAPP_TOKEN, // توكن الوصول الدائم من Meta for Developers
  WHATSAPP_PHONE_NUMBER_ID, // Phone Number ID من نفس اللوحة
  WHATSAPP_TEMPLATE_NAME, // اسم القالب المعتمد (لازم يكون Header = Document)
  WHATSAPP_TEMPLATE_LANG = "ar",
  // اسم خاصية الصورة بالطلب. غالبًا "_preview" حسب توثيق Cloudlift،
  // تأكد منه بفتح طلب تجريبي عبر Shopify Admin API (Order > line_items > properties)
  PREVIEW_PROPERTY_KEY = "_preview",
  PORT = 3000,
} = process.env;

// ---------- التحقق من أن الطلب فعلاً جاي من شوبيفاي ----------
function verifyShopifyWebhook(req) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader || !req.rawBody) return false;

  const digest = crypto
    .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(hmacHeader, "utf8")
    );
  } catch {
    return false; // أطوال مختلفة = توقيع غير صحيح
  }
}

// ---------- استخراج البيانات المطلوبة من الطلب ----------
function extractOrderInfo(order) {
  const phone =
    order.phone || order.customer?.phone || order.shipping_address?.phone;

  let imageUrl = null;
  for (const item of order.line_items || []) {
    const prop = (item.properties || []).find(
      (p) => p.name === PREVIEW_PROPERTY_KEY && p.value
    );
    if (prop) {
      imageUrl = prop.value;
      break;
    }
  }

  return { phone, imageUrl, orderNumber: order.name || String(order.id) };
}

// ---------- تنسيق رقم الهاتف لصيغة دولية بدون + أو أصفار ----------
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  return digits;
}

// ---------- إرسال المستند عبر WhatsApp Cloud API ----------
async function sendWhatsAppDocument({ to, documentUrl, filename, orderNumber }) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: WHATSAPP_TEMPLATE_NAME,
      language: { code: WHATSAPP_TEMPLATE_LANG },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "document",
              document: {
                link: documentUrl,
                filename: filename || `card-${orderNumber}.jpg`,
              },
            },
          ],
        },
        {
          type: "body",
          parameters: [{ type: "text", text: orderNumber }],
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("WhatsApp API error:", JSON.stringify(data));
    throw new Error(data?.error?.message || "فشل إرسال رسالة واتساب");
  }
  return data;
}

// ---------- نقطة استقبال الويب هوك ----------
app.post("/webhooks/orders-create", async (req, res) => {
  try {
    if (!verifyShopifyWebhook(req)) {
      return res.status(401).send("Invalid signature");
    }

    const order = req.body;
    const { phone, imageUrl, orderNumber } = extractOrderInfo(order);
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !imageUrl) {
      console.warn(
        `الطلب ${orderNumber}: ناقص رقم هاتف أو رابط صورة، تم التجاوز`
      );
      return res.status(200).send("Skipped - missing data");
    }

    await sendWhatsAppDocument({
      to: normalizedPhone,
      documentUrl: imageUrl,
      filename: `بطاقة-${orderNumber}.jpg`,
      orderNumber,
    });

    console.log(`تم إرسال البطاقة للطلب ${orderNumber} إلى ${normalizedPhone}`);
    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

app.get("/", (req, res) => res.send("WA card sender running ✅"));

app.listen(PORT, () => console.log(`يعمل على المنفذ ${PORT}`));
