# Qflavours — أداة رفع بيانات فليفرز (نسخة الويب)

موقع ثابت (HTML + ES modules، بدون build) يرفع إلى Q-Flavours عبر الـ API:
المنتجات، الخيارات والإضافات، الوصفات، وأسعار التطبيقات حسب نوع الطلب.
يُنشر تلقائياً على **Cloudflare Workers** (Worker باسم `qflavours`، عبر Workers Builds — وليس Pages) عند الدمج في `main` (ونسخة على GitHub Pages).

## قواعد العمل
- الرد على المستخدم بالعربية.
- لا build ولا npm: الملفات تُقدَّم كما هي. المكتبات في `vendor/` (SheetJS للقراءة، ExcelJS للكتابة) — لا تستخدم CDN.
- بعد أي تعديل غيّر `VERSION` في `js/app.js`.
- اختبر محلياً: `python -m http.server 8000` ثم افتح الصفحة.
- لا تضع أي مفتاح API أو بيانات حساب في المستودع (المستودع عام).

## الملفات
- `index.html` الواجهة (RTL) — `js/app.js` ربط الواجهة. صفحة الرفع خطوات متتابعة: كل قسم `data-pane="1|2|3"` شاشة مستقلة بعنوان `#step-1/2/3` (يعمل زر الرجوع في المتصفح)، شريط تقدم `#stepper`، الخطوتان 2 و3 مقفلتان قبل الاتصال (`showStep` يعيد إلى 1)، وبعد نجاح الاتصال انتقال تلقائي للخطوة 2. الروابط القديمة `#connect/#templates/#upload` ما زالت تعمل.
- `js/builder.js` قراءة الأوراق والتحقق وبناء الـ payload.
- `js/api.js` عميل Q-Flavours — `js/uploader.js` تسلسل الرفع — `js/excel.js` قراءة/كتابة Excel.
- `templates/` قوالب Excel (الأوراق: Products, Modifiers, Recipes, Delivery_Prices, Price_Rules, Ingredients_Map).
- `css/app.css` تنسيق مشترك — `js/nav.js` الشريط الجانبي الأيمن (`.sidenav`، شريط علوي تحت 860px) ودالة `api()` و`askConfirm()` — `img/` الشعار والأيقونة (مسموحان بدون دخول في `worker/middleware.js` لصفحة الدخول) — `login.html`/`js/login.js` — `users.html`/`js/users.js`.
- `delete.html`/`js/delete.js` تبويب حذف المنتجات (مديرون فقط في الواجهة؛ الصلاحية الفعلية هي مفتاح فليفرز). تأكيد بكتابة "احذف" أو "احذف الكل" ثم confirm، حذف متتابع قابل للإيقاف، وتقرير Excel. `saveXlsx`/`stamp` في `js/excel.js` مشتركة مع `app.js`.
- صفحة الحذف (`delete.html`/`js/delete.js`) بثلاثة تبويبات عبر `KINDS`: المنتجات، المواد الخام (`GET/DELETE /ingredients`)، الوصفات في المخزون (`GET/DELETE /recipes`، قسم Inventory → Recipes في فليفرز). المادة المستخدمة قد يرفضها الخادم بـ 422.
- مسح وصفة منتج (`Client.clearProductRecipe`): لا يوجد endpoint للوصفة وحدها، فيُحمَّل المنتج بـ `PRODUCT_EDIT_INCLUDES` ويُعاد إرساله بـ `productEditBody` (نفس ما يرسله شاشة تعديل المنتج في موقع فليفرز: سعر الخيار = total إذا كان شاملاً للضريبة، options = modifiers، الاستثناءات في excluded_order_types وexclusions) مع `ingredients: []`. التقرير يحفظ ما فُك ربطه لكل خيار.
- `askConfirm` يجيب من ضغطة الزر مباشرة؛ حدث `close` للـ Escape فقط (التبويب في الخلفية يؤخر الحدث).
- حذف المنتج: `DELETE /products/{id}` (X-API-Version 2.5.0) — سلوك الخادم (حذف/أرشفة/رفض لمنتج مرتبط بطلبات) غير موثق؛ 404 يُعامل كـ "غير موجود".
- `worker/` الكود الوحيد الذي يعمل على الخادم: `index.js` (المدخل والتوجيه)، `middleware.js`، `api/*.js`، `auth.js`.
- `wrangler.jsonc`: `run_worker_first` حتى تمر كل الطلبات بالـ Worker، وربط KV `USERS`. `.assetsignore` يمنع نشر `worker/` وملفات الإعداد كملفات عامة.

## اللغة والشكل
- عربي (افتراضي، RTL) وإنجليزي (LTR) عبر `js/i18n.js`: النص العربي في الـ HTML والإنجليزي في `data-en` (أو `data-en-ph` للـ placeholder و`data-en-title`)، وفي الكود `L("عربي", "English")`. ضع `data-en` فقط على عنصر لا يحتوي ids أو عناصر لها listeners؛ النص الذي يكتبه الكود (حالة الاتصال، النتيجة) يُرسم بـ `L()` ويُعاد رسمه على حدث `langchange`.
- التبديل بدون إعادة تحميل (يبقى الاتصال بفليفرز)، والاختيار في `localStorage` باسم `qf_lang`؛ سطر inline في `<head>` يضبط `dir` قبل الرسم.
- رسائل الـ Worker: `fail(["عربي", "English"])` → `{ error, error_en }`، والواجهة تختار بـ `errorText()`.
- القالب الجاهز للحساب بالإنجليزي: ورقة Instructions وتعليقات الأعمدة من `EN_INSTRUCTIONS`/`EN_NOTES` في `js/template.js`؛ أسماء الأوراق والأعمدة لا تتغير.
- الشكل مثل qflavours.qoyod.com: خط Montserrat Arabic (في `fonts/`، مسموح بدون دخول)، الأزرق `#2900ee`، النص `#0e072f`، الخلفية `#f2f2f4`، زوايا 16px. المتغيرات في أول `css/app.css`؛ استخدم خصائص logical (inline-start…) حتى يعمل الاتجاهان.

## تسجيل الدخول والمستخدمين
- `worker/middleware.js` يحمي كل الطلبات؛ المسموح بدون دخول: `/login`, `/js/login.js`, `/css/app.css`, `/api/login` (لذلك `login.js` لا يستورد أي ملف آخر).
- **قرار المستخدم: الدخول مبدئياً بالبريد فقط بدون كلمة مرور.** نسخة كلمات المرور (PBKDF2، تغيير كلمة المرور، `ADMIN_PASSWORD`) في commit `b2af000` لإرجاعها لاحقاً.
- مطلوب في Cloudflare: KV مربوط باسم `USERS` (الـ id في `wrangler.jsonc`)، وأسرار `ADMIN_EMAIL`, `SESSION_SECRET` في إعدادات الـ Worker.
- المالك (من الأسرار) لا يُخزَّن في KV ولا يُحذف. باقي المستخدمين `user:<email>` في KV.
- الأدوار: `user` يستخدم الأداة، `admin` يدير المستخدمين أيضاً. الجلسة كوكي موقّع 12 ساعة، وحذف المستخدم ينهي جلساته.
- الـ handlers بشكل Pages Functions (`onRequestGet/Post/Delete({ request, env, data, next })`) ويوجّهها `worker/index.js`؛ مسار `/api` جديد يُضاف إلى `ROUTES` هناك. تحقق الصلاحية داخل كل handler.
- نسخة GitHub Pages بلا Worker، فهي غير محمية.

## تقرير الاستخدام
- سجل النشاط في نفس مخزن KV (`USERS`) بمفاتيح `act:<ISO time>:<random>`، والحدث كله في الـ metadata (≤ 1024 بايت) حتى تكفي القائمة بدون قراءة لكل حدث، وينتهي تلقائياً بعد 180 يوماً (`RETENTION_DAYS` في `worker/activity.js`).
- `login` يسجله الخادم في `worker/api/login.js`؛ باقي الأحداث ترسلها الصفحات بـ `track()` في `js/nav.js` (لا تنتظر ولا تُظهر خطأ). الأنواع المسموحة وحقولها الرقمية في `ACTIONS`؛ البريد من الجلسة دائماً.
- `GET /api/activity?from&to` للمديرين فقط، وصفحة `activity.html`/`js/activity.js` تجمعها حسب المستخدم (مع من لا نشاط له) وتصدّر Excel.
- المعاينات تستخدم نفس مخزن KV، فأي نشاط على رابط معاينة يظهر في التقرير.

## Q-Flavours API (مستخرج من تطبيق qflavours.qoyod.com — غير موثق علناً)
- القاعدة: `https://qflavours-api.qoyod.com/pos/api/v2`
- المصادقة من المتصفح: `Authorization: Bearer <token>` فقط — هيدر `API-TOKEN` يمنعه CORS من مواقع أخرى (تحقق 2026-10-22: `Access-Control-Allow-Headers` لا يشمله).
- بـ Bearer: مفتاح خاطئ أو مفتاح غير مدعوم يعطي 403 مثل الطلب بلا مفتاح؛ بـ `API-TOKEN` المفتاح الخاطئ يعطي 401. لذلك `js/api.js` يجرّب Bearer ثم عند 401/403 يتحول إلى `/api/flavours/*` (worker/api/flavours.js) الذي يرسل `API-TOKEN` من الخادم. التمرير مثبّت على `qflavours-api.qoyod.com/pos/api/v2` فقط (ليس proxy مفتوحاً).
- `GET /me` → market من `userable.market.id`.
- التصنيفات: `GET /product-categories?filter[scope]=MANAGE&filter[market_id]=…` و `POST /product-categories {name_en, name_ar, icon}` مع `X-API-Version: 2.8.0`. الاسم المكرر → 422 "already exists" (ابحث عنه واربط به).
- أنواع الطلب: `GET /orders/types?includes[]=config` = كل الأنواع التي يعرفها فليفرز، و`is_adopted` + `config.is_active` = المسجّل/المفعّل في الحساب (الإعدادات ← أنواع الطلب). `client.orderTypes()` يرجع المسجّلة فقط؛ `orderTypeCatalog()` الكل.
- إنشاء/تفعيل نوع طلب: `POST /orders/types/configs` مع `{type_key}` لتفعيل نوع معروف أو `{name_en, name_ar}` لنوع جديد، وبقية الحقول بقيم نموذج موقع فليفرز (`ORDER_TYPE_DEFAULTS` في `js/api.js`).
- المواد الخام: `GET /ingredients`، والإنشاء `POST /ingredients` بنفس نموذج موقع فليفرز: `{name_en, name_ar, source_unit, target_unit, source_rate, target_rate, stock, cost, minimum, maximum, market_id, branch_id}` (الإلزامي: name_en، الوحدتان، النسبتان، stock). الوحدات في `INGREDIENT_UNITS` (`js/builder.js`).
- المنتج: `POST /products` و `POST /products/{id}` مع `X-API-Version: 2.5.0`:
  - `name_en, name_ar, description_en/ar, category_id, duration, market_id, branch_id, options[]` (نفس القائمة تُرسل أيضاً في `modifiers`).
  - option: `name_en, name_ar, type, pricing_type(=type), price, cost, calorie, is_tax_included(1/0), has_weight, weight_amount, weight_unit, has_stock, stock, barcode, ingredients[{ingredient_id, qty}], prices[]`.
  - `price` يجب أن يكون > 0 لـ OPTION/ADDITIONAL (الخادم يرفض 0). **قرار المستخدم: المنتج بدون سعر أو بسعر 0 = خطأ ولا يُرفع.**
  - أسعار التطبيقات: `prices[] = {priceable_type:"ORDER_TYPE", priceable_id:<order type key>, value_type:"NOMINAL", value:<السعر النهائي − السعر الأساسي>}`؛ الفرق 0 لا يُرسل.

## سلوك الأداة
- التصنيف غير الموجود يُنشأ تلقائياً (قابل للإيقاف من الواجهة).
- التطبيق/نوع الطلب غير المسجّل في Delivery_Prices أو Price_Rules (صف فيه قاعدة) يُفعَّل إن كان معروفاً في فليفرز أو يُنشأ كنوع جديد، في الرفع الفعلي فقط وبعد التصنيفات (`planOrderTypes`/`createOrderTypes` في `js/uploader.js`؛ قابل للإيقاف). النوع الجديد يأخذ مفتاحاً مؤقتاً `NEW:…` حتى يُنشأ، وإن فشل تُحذف أسعاره فقط.
- أسعار التطبيقات داخل Products / Modifiers: أي عمود غير الأعمدة العادية (`PRODUCT_COLS` / `MODIFIER_COLS` في `js/builder.js`) واسمه تطبيق مسجّل أو يعرفه فليفرز = سعر ذلك السطر في ذلك التطبيق (Products = كل المنتج، Modifiers = ذلك الخيار). يغلب Delivery_Prices لنفس الخيار مع تحذير. يُستخدم `knownPriceKey` (لا يثق بعنوان مجهول) حتى لا يتحول عمود ملاحظات إلى تطبيق؛ التطبيق الجديد كلياً يُنشأ فقط من عمود في Delivery_Prices.
- "قالب جاهز لحسابي" (`js/template.js`): يُبنى من `flavours_template_empty.xlsx` بأعمدة أنواع الطلب المسجلة والمفعّلة + ورقة Order_Types. يُكتب بـ ExcelJS من الصفر لأن ExcelJS لا يقرأ القالب الأصلي (تعليقات الخلايا)؛ القراءة بـ SheetJS.
- ورقة `Ingredients` (ليست في القوالب الثابتة، يضيفها "قالب جاهز لحسابي"): مواد خام جديدة تُنشأ في الرفع الفعلي بعد التصنيفات والتطبيقات وقبل المنتجات (`buildIngredients` في builder، `createIngredients` في uploader؛ قابل للإيقاف). الاسم الموجود في فليفرز أو Ingredients_Map يُتخطى بتحذير. وحدات عربية مقبولة (كجم، جرام، لتر، مل، حبة…)، الافتراضي kg → g، و`recipe_ratio` يُحسب للتحويلات المعروفة (kg→g = 1000…) وإلا يجب كتابته. الوصفة التي تذكر مادة جديدة تأخذ رقماً مؤقتاً `NEW-ING:<key>` يُستبدل بعد الإنشاء (أو بالبحث بالاسم إن لم يرجع الـ API الرقم)، وإن فشل إنشاؤها يفشل المنتج الذي يستخدمها. تقرير الرفع فيه ورقة Ingredients.
- المنتج الموجود بنفس `name_en` يُحدَّث (وضع upsert افتراضياً).
- أي خطأ في الملف يوقف الرفع الفعلي كله، إلا إذا فعّل المستخدم "ارفع المنتجات السليمة".
- أعمدة Delivery_Prices/Price_Rules تُطابق مفتاح أو اسم نوع الطلب بعد التطبيع (HUNGERSTATION = HUNGER_STATION = HungerStation).
