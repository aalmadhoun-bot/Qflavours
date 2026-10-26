# أداة رفع بيانات فليفرز — نسخة الويب

موقع ثابت (HTML + JavaScript) يرفع إلى **Q-Flavours** عبر الـ API:
المنتجات، الخيارات والإضافات، الوصفات (مكونات المنتج)، وأسعار تطبيقات التوصيل حسب نوع الطلب.

- يعمل بالكامل داخل المتصفح — **لا يوجد خادم**؛ المفتاح يُرسل من متصفحك مباشرة إلى `qflavours-api.qoyod.com`.
- يُستضاف مجاناً على **GitHub Pages**، وأي تعديل تحفظه في المستودع يُنشر تلقائياً خلال دقيقة تقريباً.

**الموقع:** https://aalmadhoun-bot.github.io/Qflavours/
**المستودع:** https://github.com/aalmadhoun-bot/Qflavours

## النشر على GitHub Pages (مرة واحدة)
1. المستودع: `aalmadhoun-bot/Qflavours` (يجب أن يكون Public).
2. **Add file ← Upload files** واسحب **كل محتويات** هذا المجلد (وليس المجلد نفسه) ثم **Commit changes**.
3. **Settings ← Pages**: في *Build and deployment* اختر **Deploy from a branch**، والفرع `main` والمجلد `/ (root)`، ثم **Save**.
4. بعد دقيقة يظهر الرابط: https://aalmadhoun-bot.github.io/Qflavours/

> GitHub Pages المجاني يتطلب مستودعاً عاماً. لا يوجد في الكود أي مفتاح أو بيانات سرية — المفتاح يُكتب في الصفحة وقت الاستخدام فقط.

## تسجيل الدخول والمستخدمين (Cloudflare Workers فقط)
الموقع على Cloudflare محمي بتسجيل دخول: لا يفتح أي صفحة أو ملف إلا لمستخدم مسجَّل. المدير يضيف المستخدمين ويعدّلهم ويحذفهم من صفحة **المستخدمون** في الشريط العلوي.
كل مستخدم بعد الدخول يكتب مفتاح الـ API الخاص بحسابه في فليفرز كالمعتاد.

> ⚠️ الدخول **مبدئياً بالبريد فقط بدون كلمة مرور**: من يعرف بريداً مسجَّلاً يدخل به. نسخة كلمات المرور الكاملة محفوظة في الـ commit `b2af000` ويمكن إرجاعها لاحقاً.

الموقع Worker باسم `qflavours` يُنشر عبر **Workers Builds** عند كل push. إعداداته في `wrangler.jsonc`، والكود الذي يعمل على الخادم في `worker/`.

الإعداد مرة واحدة:
1. لوحة Cloudflare ← **Storage & Databases ← KV ← Create** باسم مثل `qflavours-users`، وانسخ الـ **ID** الخاص به.
2. ضع الـ ID في `wrangler.jsonc` في `kv_namespaces` (الـ ID ليس سراً). المخزن الحالي مضبوط مسبقاً.
3. Worker `qflavours` ← **Settings ← Variables and Secrets** وأضف (نوع *Secret*):
   - `ADMIN_EMAIL` بريد المالك.
   - `SESSION_SECRET` نص عشوائي طويل (32 حرفاً أو أكثر) — تغييره يُخرج جميع المستخدمين.
4. ادفع التعديل؛ بعد نجاح النشر ادخل بحساب المالك وأضف المستخدمين.

> الأسرار تبقى كما هي مع كل نشر لأنها ليست في `wrangler.jsonc`.

**معاينة الفروع:** كل فرع غير `main` يُنشر بأمر `wrangler preview` على رابط مثل `https://<اسم-الفرع>-qflavours.a-almadhoun.workers.dev`، ويستخدم نفس مخزن KV (قسم `previews` في `wrangler.jsonc`). المعاينة **لا ترث أسرار الإنتاج**، ولا تُضاف من اللوحة، بل بالأوامر (تحتاج Node.js و`npx wrangler login`):
```bash
npx wrangler preview base-config secret put ADMIN_EMAIL
```
```bash
npx wrangler preview base-config secret put SESSION_SECRET
```
هذه القيم الأساسية تُطبَّق على المعاينات **الجديدة** فقط (وهي مضبوطة حالياً). لمعاينة موجودة استخدم `npx wrangler preview secret put NAME --name <اسم-المعاينة>`.

> حساب المالك لا يُحذف ولا يُعدَّل من الموقع؛ يُغيَّر من `ADMIN_EMAIL`.
> نسخة **GitHub Pages لا تدعم تسجيل الدخول** وتبقى مفتوحة لأي شخص — أوقفها من *Settings ← Pages* إذا أردت أن يكون الدخول عبر الحسابات فقط.

## التعديل لاحقاً
عدّل أي ملف من GitHub مباشرة (أيقونة القلم ✏️) ثم **Commit** — يُحدَّث الموقع تلقائياً.
تابع حالة النشر من تبويب **Actions** في المستودع.

## الملفات
| الملف | الوظيفة |
|---|---|
| `index.html` | الواجهة |
| `login.html` / `users.html` | صفحة الدخول وصفحة إدارة المستخدمين |
| `activity.html` / `js/activity.js` | **تقرير الاستخدام** (للمديرين): لكل مستخدم الدخول والاتصالات والفحص والرفع والحذف والتحميلات وآخر نشاط، لأي فترة حتى 180 يوماً، مع تصدير Excel |
| `worker/activity.js` | سجل النشاط في KV (ينتهي تلقائياً بعد 180 يوماً) |
| `delete.html` / `js/delete.js` | **حذف البيانات** (للمديرين) بثلاثة تبويبات: المنتجات (حذف، أو مسح الوصفة فقط مع إبقاء المنتج)، المواد الخام، والوصفات من المخزون — مع نسخة احتياطية، تأكيد، إيقاف، وتقرير |
| `css/app.css` | التنسيق المشترك بشكل فليفرز (الخط، الألوان، الزوايا) |
| `js/i18n.js` | اللغة: عربي/إنجليزي، زر التبديل في الشريط الجانبي وصفحة الدخول |
| `fonts/` | خط Montserrat Arabic (نفس خط برنامج فليفرز) |
| `img/` | شعار فليفرز (`flavours-logo.png` من موقع فليفرز الرسمي) وأيقونة التبويب `flavours-icon.png` |
| `js/app.js` | ربط الواجهة بالمنطق |
| `js/nav.js` | الشريط الجانبي على يمين الصفحة (التنقل، الحساب، الخروج)، ويتحول لشريط علوي بزر قائمة على الجوال |
| `js/users.js` / `js/login.js` | منطق صفحتي المستخدمين والدخول |
| `wrangler.jsonc` / `.assetsignore` | إعداد الـ Worker والملفات التي لا تُنشر كملفات عامة |
| `worker/` | كود الخادم: `index.js` المدخل، `middleware.js` حماية الموقع، `api/` لـ `/api/login`, `/api/me`, `/api/users`, `/api/logout`، و`/api/flavours/*` (تمرير إلى فليفرز بـ API-TOKEN) |
| `worker/auth.js` | الجلسات الموقّعة وتخزين المستخدمين في KV |
| `js/builder.js` | قراءة القالب، التحقق من البيانات، وبناء طلبات المنتجات |
| `js/api.js` | الاتصال بـ Q-Flavours API |
| `js/uploader.js` | خطوات الرفع: التصنيفات ← التطبيقات (أنواع الطلب) ← المنتجات ← التقرير |
| `js/template.js` | "قالب جاهز لحسابي": قالب الرفع بعمود لكل نوع طلب مسجّل بعد `price` في Products و Modifiers (سعر المنتج/الخيار في ذلك التطبيق)، ونفس الأنواع في Delivery_Prices و Price_Rules، + ورقة Order_Types |
| `js/excel.js` | قراءة ملف Excel وكتابة التقارير |
| `templates/` | قوالب Excel |
| `vendor/` | مكتبات SheetJS و ExcelJS (محلية، بدون CDN) |

## ملاحظات تقنية
- العنوان الافتراضي: `https://qflavours-api.qoyod.com/pos/api/v2` (قابل للتغيير من "إعدادات متقدمة").
- المصادقة: أولاً `Authorization: Bearer` من المتصفح مباشرة. هيدر `API-TOKEN` يمنعه خادم فليفرز من المتصفحات (CORS)، فإذا رُفض Bearer بـ 401/403 تنتقل الأداة تلقائياً إلى `/api/flavours/*` في الـ Worker، الذي يعيد إرسال الطلب نفسه بهيدر `API-TOKEN` (المفتاح لا يُخزَّن ولا يُسجَّل).
  هذا التحويل يعمل على نسخة Cloudflare فقط؛ نسخة GitHub Pages تبقى بـ Bearer وحده.
- المنتجات: `POST /products` و `POST /products/{id}` مع `X-API-Version: 2.5.0`، والخيارات في `options`.
- أنواع الطلب: `GET /orders/types` (المسجّلة = `is_adopted`)، والتطبيق غير المسجّل يُفعَّل/يُنشأ بـ `POST /orders/types/configs` عند الرفع الفعلي.
- أسعار التطبيقات: لكل خيار `prices[] = {priceable_type: "ORDER_TYPE", priceable_id: <مفتاح نوع الطلب>, value_type: "NOMINAL", value: السعر النهائي − السعر الأساسي}`.
- التصنيفات: `GET/POST /product-categories` مع `X-API-Version: 2.8.0` و `filter[scope]=MANAGE`.
- لا يُرفع أي منتج أو خيار بدون سعر أو بسعر 0.
- حذف المنتجات: `DELETE /products/{id}` مع `X-API-Version: 2.5.0`، منتجاً منتجاً بالتتابع. الحذف نهائي؛ حمّل النسخة الاحتياطية أولاً وجرّب على منتج محدد قبل حذف الكل.

## تجربة محلية
```bash
python -m http.server 8000
# ثم افتح http://localhost:8000
```
هذا يعرض الصفحات فقط؛ تسجيل الدخول والمستخدمين يحتاجان الـ Worker، فجرّبهما بنسخة المعاينة التي ينشئها Workers Builds لكل فرع.
