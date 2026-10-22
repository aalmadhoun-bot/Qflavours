# Qflavours — أداة رفع بيانات فليفرز (نسخة الويب)

موقع ثابت (HTML + ES modules، بدون build) يرفع إلى Q-Flavours عبر الـ API:
المنتجات، الخيارات والإضافات، الوصفات، وأسعار التطبيقات حسب نوع الطلب.
يُنشر تلقائياً على Cloudflare Pages عند الدمج في `main` (ونسخة على GitHub Pages).

## قواعد العمل
- الرد على المستخدم بالعربية.
- لا build ولا npm: الملفات تُقدَّم كما هي. المكتبات في `vendor/` (SheetJS للقراءة، ExcelJS للكتابة) — لا تستخدم CDN.
- بعد أي تعديل غيّر `VERSION` في `js/app.js`.
- اختبر محلياً: `python -m http.server 8000` ثم افتح الصفحة.
- لا تضع أي مفتاح API أو بيانات حساب في المستودع (المستودع عام).

## الملفات
- `index.html` الواجهة (RTL) — `js/app.js` ربط الواجهة.
- `js/builder.js` قراءة الأوراق والتحقق وبناء الـ payload.
- `js/api.js` عميل Q-Flavours — `js/uploader.js` تسلسل الرفع — `js/excel.js` قراءة/كتابة Excel.
- `templates/` قوالب Excel (الأوراق: Products, Modifiers, Recipes, Delivery_Prices, Price_Rules, Ingredients_Map).

## Q-Flavours API (مستخرج من تطبيق qflavours.qoyod.com — غير موثق علناً)
- القاعدة: `https://qflavours-api.qoyod.com/pos/api/v2`
- المصادقة من المتصفح: `Authorization: Bearer <token>` فقط — هيدر `API-TOKEN` يمنعه CORS من مواقع أخرى.
- `GET /me` → market من `userable.market.id`.
- التصنيفات: `GET /product-categories?filter[scope]=MANAGE&filter[market_id]=…` و `POST /product-categories {name_en, name_ar, icon}` مع `X-API-Version: 2.8.0`. الاسم المكرر → 422 "already exists" (ابحث عنه واربط به).
- أنواع الطلب: `GET /orders/types` (كل عنصر فيه `key`).
- المواد الخام: `GET /ingredients`.
- المنتج: `POST /products` و `POST /products/{id}` مع `X-API-Version: 2.5.0`:
  - `name_en, name_ar, description_en/ar, category_id, duration, market_id, branch_id, options[]` (نفس القائمة تُرسل أيضاً في `modifiers`).
  - option: `name_en, name_ar, type, pricing_type(=type), price, cost, calorie, is_tax_included(1/0), has_weight, weight_amount, weight_unit, has_stock, stock, barcode, ingredients[{ingredient_id, qty}], prices[]`.
  - `price` يجب أن يكون > 0 لـ OPTION/ADDITIONAL (الخادم يرفض 0). **قرار المستخدم: المنتج بدون سعر أو بسعر 0 = خطأ ولا يُرفع.**
  - أسعار التطبيقات: `prices[] = {priceable_type:"ORDER_TYPE", priceable_id:<order type key>, value_type:"NOMINAL", value:<السعر النهائي − السعر الأساسي>}`؛ الفرق 0 لا يُرسل.

## سلوك الأداة
- التصنيف غير الموجود يُنشأ تلقائياً (قابل للإيقاف من الواجهة).
- المنتج الموجود بنفس `name_en` يُحدَّث (وضع upsert افتراضياً).
- أي خطأ في الملف يوقف الرفع الفعلي كله، إلا إذا فعّل المستخدم "ارفع المنتجات السليمة".
- أعمدة Delivery_Prices/Price_Rules تُطابق مفتاح أو اسم نوع الطلب بعد التطبيع (HUNGERSTATION = HUNGER_STATION = HungerStation).
