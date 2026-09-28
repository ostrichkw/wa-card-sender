# إرسال بطاقة التهنئة المخصصة عبر واتساب

هذا الكود يستقبل كل طلب جديد من شوبيفاي، يسحب صورة البطاقة النهائية (بعد إضافة الاسم والتاريخ عبر Cloudlift) ورقم هاتف العميل، ويرسلها كـ**مستند (Document)** عبر واتساب — بدون ضغط الصورة.

## خطوة ١: تأكد من اسم خاصية الصورة بالطلب

1. من Shopify Admin، افتح أي طلب تجريبي فيه بطاقة مخصصة.
2. تحت المنتج، شوف الخصائص (Properties) — الخصائص اللي تبدأ بـ `_` مخفية بالواجهة العادية، فاستخدم واحدة من:
   - تصدير الطلب كـ CSV/JSON من لوحة التحكم.
   - أو Shopify Admin API (`GET /admin/api/2024-01/orders/{id}.json`) وشوف داخل `line_items[].properties`.
3. لاحظ الاسم بالضبط (الافتراضي المتوقع من توثيق Cloudlift هو `_preview`). إذا كان مختلف، غيّره في متغير البيئة `PREVIEW_PROPERTY_KEY`.

## خطوة ٢: أنشئ حساب WhatsApp Cloud API

1. سوّي حساب على [developers.facebook.com](https://developers.facebook.com) وأنشئ تطبيق (App) من نوع Business.
2. أضف منتج "WhatsApp" للتطبيق، واربط رقم هاتف تجاري (أو استخدم رقم الاختبار المجاني بالبداية).
3. من لوحة WhatsApp بالتطبيق، احصل على:
   - **Temporary/Permanent Access Token** (التوكن الدائم يحتاج مراجعة تطبيقك من Meta).
   - **Phone Number ID**.
4. أكمل التحقق من نشاطك التجاري (Business Verification) لرفع الحدود وتقليل احتمال أي قيود.

## خطوة ٣: أنشئ قالب رسالة معتمد (Template)

1. من لوحة WhatsApp Manager، أنشئ قالب جديد:
   - **Category**: Utility
   - **Header type**: Document
   - **Body**: مثلاً "تم تأكيد طلبك رقم {{1}}، بطاقتك مرفقة 🎉"
2. أرسله للمراجعة من Meta (تاخذ عادة من دقائق لساعات).
3. بعد الموافقة، انسخ اسم القالب بالضبط لمتغير البيئة `WHATSAPP_TEMPLATE_NAME`.

## خطوة ٤: جهّز متغيرات البيئة

انسخ هذي القيم (مثلاً بملف `.env` أو بإعدادات الاستضافة):

```
SHOPIFY_WEBHOOK_SECRET=xxxx
WHATSAPP_TOKEN=xxxx
WHATSAPP_PHONE_NUMBER_ID=xxxx
WHATSAPP_TEMPLATE_NAME=order_card_confirmation
WHATSAPP_TEMPLATE_LANG=ar
PREVIEW_PROPERTY_KEY=_preview
```

## خطوة ٥: استضف الكود

أسهل خيار: [Render.com](https://render.com) (فيه باقة مجانية):
1. ارفع هذا المجلد على GitHub.
2. أنشئ "Web Service" جديد بـ Render واربطه بالمستودع.
3. أضف متغيرات البيئة أعلاه من لوحة Render.
4. بعد النشر، راح ياخذ رابط مثل: `https://your-app.onrender.com`

## خطوة ٦: فعّل الويب هوك بشوبيفاي

1. من Shopify Admin: Settings > Notifications > انزل لـ Webhooks.
2. أنشئ Webhook جديد:
   - **Event**: Order creation
   - **Format**: JSON
   - **URL**: `https://your-app.onrender.com/webhooks/orders-create`
3. شوبيفاي بيعطيك "Signing secret" — هذا هو `SHOPIFY_WEBHOOK_SECRET`.

## خطوة ٧: اختبار

سوّي طلب تجريبي حقيقي برقم هاتفك، وتأكد توصلك رسالة واتساب فيها البطاقة كملف مرفق بجودة كاملة.

---

### ملاحظات مهمة

- **الجودة**: لأن الملف يُرسل كـ Document وليس Photo، ما ينضغط من واتساب — بس العميل بيشوفه كملف يحتاج يفتحه، مو صورة تنعرض مباشرة بالمحادثة.
- **التكلفة**: هذي الرسالة تندرج تحت تصنيف Utility (الأرخص عند Meta)، ومجانية إذا العميل تفاعل وياك خلال ٢٤ ساعة.
- **رقم الهاتف**: تأكد إن حقل الهاتف بالطلب فعلاً معبأ (Shopify ما يجبر العميل يدخله دائمًا حسب إعدادات المتجر) — إذا فاضي، الكود يتجاوز الطلب ولا يرسل شي (تقدر تشوف هذا بالـ logs).
