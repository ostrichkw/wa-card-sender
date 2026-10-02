// server.js
// Receives Shopify's "order creation" webhook, pulls the customized card
// image URL (from Cloudlift) and the customer's phone number, and sends
// the image via WhatsApp Cloud API as a "document" (avoids image compression).

import express from "express";
import crypto from "crypto";

const app = express();

// Log EVERY incoming request, no matter what, so we can tell whether
// requests are reaching this server at all.
app.use((req, res, next) => {
  console.log(`>>> Incoming request: ${req.method} ${req.originalUrl}`);
  next();
});

// We need the raw request body to verify Shopify's HMAC signature.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const {
  SHOPIFY_WEBHOOK_SECRET, // From Shopify: Settings > Notifications > Webhooks
  WHATSAPP_TOKEN, // Permanent access token from Meta for Developers
  WHATSAPP_PHONE_NUMBER_ID, // Phone Number ID from the same dashboard
  WHATSAPP_TEMPLATE_NAME, // Approved template name (Header must be Document)
  WHATSAPP_TEMPLATE_LANG = "ar",
  // Name of the order property holding the preview image link.
  // Usually "_preview" per Cloudlift's docs, but verify via the Shopify
  // Admin API (Order > line_items > properties) on a real test order.
  PREVIEW_PROPERTY_KEY = "_preview",
  PORT = 3000,
} = process.env;

// ---------- Verify the webhook really came from Shopify ----------
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
    return false; // different lengths = signature mismatch
  }
}

// ---------- Extract what we need from the order payload ----------
function extractOrderInfo(order) {
  // Prefer numbers that already include a country code (longer digit
  // strings / start with "+"), since address-level phone fields often
  // store only the local number without it.
  const phoneCandidates = [
    order.phone,
    order.customer?.phone,
    order.customer?.default_address?.phone,
    order.shipping_address?.phone,
    order.billing_address?.phone,
  ].filter(Boolean);

  const phone =
    phoneCandidates.find((p) => p.replace(/\D/g, "").length >= 10) ||
    phoneCandidates[0];

  const customerName =
    order.customer?.first_name ||
    order.shipping_address?.first_name ||
    order.billing_address?.first_name ||
    null;

  // Check each property's VALUE (not just its name) so we catch the
  // Cloudlift link regardless of the exact property key used
  // (_preview, original, etc.)
  let imageUrl = null;
  for (const item of order.line_items || []) {
    const byKey = (item.properties || []).find(
      (p) => p.name === PREVIEW_PROPERTY_KEY && p.value
    );
    const byValue = (item.properties || []).find(
      (p) =>
        typeof p.value === "string" &&
        (p.value.includes("cloudlift") || p.value.includes("/uploads/"))
    );
    const prop = byKey || byValue;
    if (prop) {
      imageUrl = prop.value;
      break;
    }
  }

  return {
    phone,
    imageUrl,
    customerName,
    orderNumber: order.name || String(order.id),
  };
}

// ---------- Normalize phone to international digits, no + or leading 0 ----------
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  return digits;
}

// ---------- Send the document via WhatsApp Cloud API ----------
// Template "order_card_confirmation" has 2 body variables:
// {{1}} = customer name, {{2}} = order number.
async function sendWhatsAppDocument({
  to,
  documentUrl,
  filename,
  orderNumber,
  customerName,
}) {
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
          parameters: [
            { type: "text", text: customerName || "customer" },
            { type: "text", text: orderNumber },
          ],
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
    throw new Error(data?.error?.message || "Failed to send WhatsApp message");
  }
  return data;
}

// ---------- Webhook endpoint ----------
app.post("/webhooks/orders-create", async (req, res) => {
  try {
    if (!verifyShopifyWebhook(req)) {
      console.warn(
        "!!! Signature verification FAILED. Header present:",
        !!req.get("X-Shopify-Hmac-Sha256"),
        "rawBody present:",
        !!req.rawBody
      );
      return res.status(401).send("Invalid signature");
    }
    console.log("Signature verified OK.");

    const order = req.body;
    const { phone, imageUrl, orderNumber, customerName } =
      extractOrderInfo(order);
    const normalizedPhone = normalizePhone(phone);

    // --- DEBUG: print exactly what we found, to diagnose missing data ---
    console.log(`--- DEBUG Order ${orderNumber} ---`);
    console.log("raw phone:", phone);
    console.log("normalized phone:", normalizedPhone);
    console.log("imageUrl:", imageUrl);
    console.log("customerName:", customerName);
    console.log("order.phone (top-level):", order.phone);
    console.log("order.customer:", JSON.stringify(order.customer, null, 2));
    console.log(
      "order.shipping_address:",
      JSON.stringify(order.shipping_address, null, 2)
    );
    console.log(
      "order.billing_address:",
      JSON.stringify(order.billing_address, null, 2)
    );
    console.log(
      "line_items properties:",
      JSON.stringify(
        (order.line_items || []).map((li) => li.properties),
        null,
        2
      )
    );
    console.log("--- END DEBUG ---");

    if (!normalizedPhone || !imageUrl) {
      console.warn(
        `Order ${orderNumber}: missing phone or image link, skipped`
      );
      return res.status(200).send("Skipped - missing data");
    }

    await sendWhatsAppDocument({
      to: normalizedPhone,
      documentUrl: imageUrl,
      filename: `card-${orderNumber}.jpg`,
      orderNumber,
      customerName,
    });

    console.log(`Sent card for order ${orderNumber} to ${normalizedPhone}`);
    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

app.get("/", (req, res) => res.send("WA card sender running"));

// ---------- TEMPORARY DEBUG: list real templates + their exact language codes ----------
app.get("/debug-templates", async (req, res) => {
  try {
    const wabaId = process.env.WHATSAPP_WABA_ID || "2113421062944628";
    const url = `https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=name,language,status&limit=100`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
