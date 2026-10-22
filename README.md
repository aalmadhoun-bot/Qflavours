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

## تسجيل الدخول والمستخدمين (Cloudflare Pages فقط)
الموقع على Cloudflare محمي بتسجيل دخول: لا يفتح أي صفحة أو ملف إلا لمستخدم مسجَّل. المدير يضيف المستخدمين ويعدّلهم ويحذفهم من صفحة **المستخدمون** في الشريط العلوي.
كل مستخدم بعد الدخول يكتب مفتاح الـ API الخاص بحسابه في فليفرز كالمعتاد.

الإعداد مرة واحدة في لوحة Cloudflare:
1. **Workers & Pages ← KV ← Create namespace** باسم مثل `qflavours-users`.
2. مشروع الـ Pages ← **Settings ← Bindings ← Add ← KV namespace**: اسم المتغير `USERS` واختر المخزن السابق.
3. **Settings ← Variables and Secrets** وأضف (نوع *Secret*):
   - `ADMIN_EMAIL` بريد المالك.
   - `ADMIN_PASSWORD` كلمة مرور المالك (طويلة وقوية).
   - `SESSION_SECRET` نص عشوائي طويل (32 حرفاً أو أكثر) — تغييره يُخرج جميع المستخدمين.
4. أعد النشر (**Deployments ← Retry deployment**) ثم ادخل بحساب المالك وأضف المستخدمين.

> حساب المالك لا يُحذف ولا يُعدَّل من الموقع؛ تُغيَّر كلمة مروره من `ADMIN_PASSWORD`.
> نسخة **GitHub Pages لا تدعم تسجيل الدخول** وتبقى مفتوحة لأي شخص — أوقفها من *Settings ← Pages* إذا أردت أن يكون الدخول عبر الحسابات فقط.

## التعديل لاحقاً
عدّل أي ملف من GitHub مباشرة (أيقونة القلم ✏️) ثم **Commit** — يُحدَّث الموقع تلقائياً.
تابع حالة النشر من تبويب **Actions** في المستودع.

## الملفات
| الملف | الوظيفة |
|---|---|
| `index.html` | الواجهة |
| `login.html` / `users.html` | صفحة الدخول وصفحة إدارة المستخدمين |
| `css/app.css` | التنسيق المشترك لكل الصفحات |
| `js/app.js` | ربط الواجهة بالمنطق |
| `js/nav.js` | الشريط العلوي (التنقل، الحساب، تغيير كلمة المرور، الخروج) |
| `js/users.js` / `js/login.js` | منطق صفحتي المستخدمين والدخول |
| `functions/` | Cloudflare Pages Functions: حماية الموقع و `/api/login`, `/api/me`, `/api/users`, `/api/password`, `/api/logout` |
| `lib/auth.js` | تشفير كلمات المرور (PBKDF2) والجلسات الموقّعة وتخزين المستخدمين في KV |
| `js/builder.js` | قراءة القالب، التحقق من البيانات، وبناء طلبات المنتجات |
| `js/api.js` | الاتصال بـ Q-Flavours API |
| `js/uploader.js` | خطوات الرفع: التصنيفات ← المنتجات ← التقرير |
| `js/excel.js` | قراءة ملف Excel وكتابة التقارير |
| `templates/` | قوالب Excel |
| `vendor/` | مكتبات SheetJS و ExcelJS (محلية، بدون CDN) |

## ملاحظات تقنية
- العنوان الافتراضي: `https://qflavours-api.qoyod.com/pos/api/v2` (قابل للتغيير من "إعدادات متقدمة").
- المصادقة عبر `Authorization: Bearer` فقط؛ هيدر `API-TOKEN` يمنعه المتصفح لهذا الخادم (CORS) عند الاستخدام من موقع آخر.
  إذا ظهر خطأ 401/403 والمفتاح صحيح، فالمفتاح لا يعمل بطريقة Bearer — استخدم نسخة سطح المكتب (exe).
- المنتجات: `POST /products` و `POST /products/{id}` مع `X-API-Version: 2.5.0`، والخيارات في `options`.
- أسعار التطبيقات: لكل خيار `prices[] = {priceable_type: "ORDER_TYPE", priceable_id: <مفتاح نوع الطلب>, value_type: "NOMINAL", value: السعر النهائي − السعر الأساسي}`.
- التصنيفات: `GET/POST /product-categories` مع `X-API-Version: 2.8.0` و `filter[scope]=MANAGE`.
- لا يُرفع أي منتج أو خيار بدون سعر أو بسعر 0.

## تجربة محلية
```bash
python -m http.server 8000
# ثم افتح http://localhost:8000
```
هذا يعرض الصفحات فقط؛ تسجيل الدخول والمستخدمين يحتاجان Functions، فجرّبهما برابط المعاينة الذي ينشئه Cloudflare لكل فرع.
