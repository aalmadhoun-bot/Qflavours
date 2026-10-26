// Upload template for the connected account: the stock empty template's sheets, instructions and header notes,
// plus a price column per registered order type after `price` in Products / Modifiers, and the same types as
// the Delivery_Prices columns and Price_Rules keys.
// Built fresh with ExcelJS because ExcelJS can't load the stock file (its header comments break its reader);
// SheetJS reads the stock file. In English the instructions and notes come from the EN_* tables below
// (translations of the stock file's Arabic); sheet and column names never change, the upload relies on them.
import { L, lang } from "./i18n.js";
import { INGREDIENT_UNITS } from "./builder.js";

const SOURCE = "templates/flavours_template_empty.xlsx";
const FIXED_PRICE_COLS = ["product_code", "modifier_name_en"];
const INSTRUCTIONS = "تعليمات";

const EN_INSTRUCTIONS = [
  "Flavours data upload tool — how to fill in the template",
  "",
  "1) Products: one row per product. product_code is your own code (e.g. P001) that links the sheets together.",
  "   • Single-price product with no sizes? Put the price in the price column and add nothing for it in Modifiers (a default option named after the product is created).",
  "2) Modifiers: the product's options (sizes = OPTION) and add-ons (ADDITIONAL). Every product needs at least one OPTION.",
  "3) Recipes: the recipe = ingredients and their quantities. Leave modifier_name_en empty to apply it to all of the product's sizes, or name the size.",
  "4) Delivery_Prices: the final price of each option in each app/order type. The column header = the order type key or its name as in Flavours (see the Order_Types sheet in the reference data file). You can add columns.",
  "5) Price_Rules: instead of writing every price — a markup per app (e.g. HUNGERSTATION +20%). A price written explicitly in Delivery_Prices takes priority.",
  "6) Ingredients_Map: optional — maps an ingredient name to its ID if it isn't fetched automatically.",
  "",
  "Notes:",
  "• Red columns are required. Don't rename the columns in the first row.",
  "• A category that doesn't exist in Flavours is created automatically (you can put its Arabic name in category_ar).",
  "• No product or option is uploaded without a price or with a price of 0 — the price must be greater than 0.",
  "• A recipe ingredient must exist in Flavours or be listed in the Ingredients sheet (created on upload) — use (Export reference data) to see the existing ones.",
  "• A product with the same English name is updated (depending on the chosen mode); otherwise a new one is created.",
  "• Run (Dry run) before the live upload.",
];

const EN_NOTES = {
  "Products.product_code": "Unique internal product code used to link the other sheets (not uploaded)",
  "Products.name_en": "Product name in English (used to match existing products)",
  "Products.name_ar": "Product name in Arabic",
  "Products.category": "Category name (or ID). If it doesn't exist in Flavours it is created automatically with this name",
  "Products.price": "Product price — used when the product has no options in Modifiers (must be greater than 0)",
  "Products.cost": "Product cost (for the default option)",
  "Products.calorie": "Calories (for the default option)",
  "Products.barcode": "Barcode of the default option",
  "Products.is_tax_included": "Is the price tax-inclusive? yes/no (default: yes)",
  "Products.description_en": "Description in English",
  "Products.description_ar": "Description in Arabic",
  "Products.preparation_time": "Preparation time in minutes",
  "Products.stock": "Stock — leave empty = unlimited",
  "Products.branch_id": "Branch ID (optional — only if the product belongs to one branch)",
  "Products.category_ar": "Category name in Arabic — used when creating a new category (empty = same as category)",
  "Modifiers.product_code": "Product code from the Products sheet",
  "Modifiers.modifier_name_en": "Option/add-on name in English, e.g. Small / Large / Extra Cheese",
  "Modifiers.modifier_name_ar": "Name in Arabic",
  "Modifiers.type": "OPTION (size/main choice), ADDITIONAL (add-on), OPTION_VARIABLE or ADDITIONAL_VARIABLE",
  "Modifiers.price": "Base price (dine-in/cashier) — must be greater than 0",
  "Modifiers.cost": "Cost",
  "Modifiers.calorie": "Calories",
  "Modifiers.barcode": "Barcode (must be unique)",
  "Modifiers.is_tax_included": "Tax-inclusive? yes/no — empty = same as the product",
  "Modifiers.weight_amount": "Only if priced by weight",
  "Modifiers.weight_unit": "Weight unit, e.g. Kg",
  "Recipes.product_code": "Product code",
  "Recipes.modifier_name_en": "Option name — empty = the ingredients apply to all of the product's OPTIONs",
  "Recipes.ingredient": "Ingredient name (Arabic/English) or its ID",
  "Recipes.qty": "Quantity used (in the ingredient's unit in Flavours)",
  "Delivery_Prices.product_code": "Product code",
  "Delivery_Prices.modifier_name_en": "Option name — empty = the price for all of the product's options that have no row of their own",
  "Price_Rules.payment_method_key": "Payment method / delivery app key, e.g. HUNGERSTATION",
  "Price_Rules.markup_percent": "Markup on the base price, e.g. 20 = +20%",
  "Price_Rules.fixed_add": "Fixed amount added after the percentage",
  "Price_Rules.round_to": "Round up to the nearest (e.g. 0.5 or 1) — empty = no rounding",
  "Price_Rules.applies_to": "ALL (default), OPTION or ADDITIONAL",
  "Ingredients_Map.ingredient_name": "The name as you write it in the Recipes sheet",
  "Ingredients_Map.ingredient_id": "The ingredient's ID in Flavours — used if the tool can't fetch it automatically",
};

// Ingredients sheet (not in the stock template): new ingredients the upload creates before the products.
const INGREDIENT_COLS = ["name_en", "name_ar", "storage_unit", "recipe_unit", "storage_ratio", "recipe_ratio", "stock", "cost", "minimum", "maximum"];
const INGREDIENT_NOTES = {
  name_en: ["اسم المادة الخام بالإنجليزي (إلزامي) — الاسم الموجود مسبقاً في فليفرز يُتخطى", "Ingredient name in English (required) — a name that already exists in Flavours is skipped"],
  name_ar: ["الاسم بالعربي — يمكن استخدامه في ورقة Recipes", "Name in Arabic — can be used in the Recipes sheet"],
  storage_unit: ["وحدة التخزين/الشراء (فارغ = kg)", "Storage/purchase unit (empty = kg)"],
  recipe_unit: ["وحدة الوصفة: الكمية في ورقة Recipes بهذه الوحدة (فارغ = g)", "Recipe unit: the qty in the Recipes sheet is in this unit (empty = g)"],
  storage_ratio: ["عدد وحدات التخزين في التحويل (فارغ = 1)", "Number of storage units in the conversion (empty = 1)"],
  recipe_ratio: ["كم وحدة وصفة تساوي storage_ratio من وحدة التخزين، مثل 1 kg = 1000 g — فارغ = يُحسب تلقائياً للوحدات المعروفة", "How many recipe units equal storage_ratio storage units, e.g. 1 kg = 1000 g — empty = worked out for known units"],
  stock: ["المخزون الحالي بوحدة التخزين (فارغ = 0)", "Current stock in the storage unit (empty = 0)"],
  cost: ["التكلفة (اختياري)", "Cost (optional)"],
  minimum: ["الحد الأدنى للمخزون (اختياري)", "Minimum stock (optional)"],
  maximum: ["الحد الأعلى للمخزون (اختياري)", "Maximum stock (optional)"],
};

function addIngredientsSheet(wb) {
  const notes = Object.fromEntries(Object.entries(INGREDIENT_NOTES).map(([k, [ar, en]]) => [k, L(ar, en)]));
  const ws = addTable(wb, "Ingredients", INGREDIENT_COLS, notes);
  ws.getRow(1).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC00000" } };  // required
  const units = { type: "list", allowBlank: true, formulae: [`"${INGREDIENT_UNITS.join(",")}"`] };
  for (let r = 2; r <= 500; r++) for (const c of ["C", "D"]) ws.getCell(`${c}${r}`).dataValidation = units;
}

function styleHeader(ws) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2900EE" } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function addTable(wb, name, header, notes = {}, rows = []) {
  const ws = wb.addWorksheet(name);
  ws.columns = header.map((h) => ({ header: h, key: h, width: Math.max(14, String(h).length + 4) }));
  header.forEach((h, i) => { if (notes[h]) ws.getRow(1).getCell(i + 1).note = notes[h]; });
  for (const r of rows) ws.addRow(r);
  styleHeader(ws);
  return ws;
}

export async function accountTemplate(ctx) {
  const XLSX = globalThis.XLSX;
  const src = XLSX.read(await (await fetch(SOURCE)).arrayBuffer());
  const types = ctx.orderTypes.filter((t) => t.key && t.active !== false);  // legacy lists carry no status: keep all
  const typeName = (t) => L(t.name_ar, t.name_en) || t.name_en || t.name_ar || t.key;
  const rtl = lang !== "en";
  const wb = new globalThis.ExcelJS.Workbook();

  for (const name of src.SheetNames) {
    const ws = src.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (name === INSTRUCTIONS) {
      const out = wb.addWorksheet(L(INSTRUCTIONS, "Instructions"), { views: [{ rightToLeft: rtl }] });
      out.getColumn(1).width = 120;
      (rtl ? rows.map((r) => r[0] ?? "") : EN_INSTRUCTIONS).forEach((line) => out.addRow([line]));
      out.addRow([""]);
      out.addRow([L(`هذا القالب خاص بحساب Market ${ctx.marketId ?? "-"} (صُدّر ${new Date().toLocaleDateString("ar-SA-u-nu-latn")}).`,
        `This template is for Market ${ctx.marketId ?? "-"} (exported ${new Date().toLocaleDateString("en-GB")}).`)]).font = { bold: true };
      out.addRow([L("أسعار التطبيقات: بعد عمود price في ورقتي Products و Modifiers يوجد عمود لكل تطبيق مسجّل في هذا الحساب — اكتب فيه سعر المنتج أو الخيار/الإضافة في ذلك التطبيق في نفس السطر.",
        "App prices: right after the price column in Products and Modifiers there is a column for each app registered in this account — write the product's or option's/add-on's price in that app on the same row.")]);
      out.addRow([L("نفس التطبيقات هي أعمدة ورقة Delivery_Prices (اختيارية) ومفاتيح Price_Rules، وقائمتها كاملة في ورقة Order_Types.",
        "The same apps are the columns of the Delivery_Prices sheet (optional) and the Price_Rules keys; the full list is in the Order_Types sheet.")]);
      out.addRow([L("لإضافة تطبيق غير مسجّل أضف عموداً باسمه (مثل HUNGERSTATION)؛ ستفعّله الأداة أو تنشئه في حسابك عند الرفع الفعلي.",
        "To add an app that isn't registered, add a column with its name (e.g. HUNGERSTATION); the tool enables or creates it in your account on a live upload.")]);
      out.addRow([L("مواد خام جديدة: اكتبها في ورقة Ingredients (الاسم، وحدة التخزين ووحدة الوصفة، المخزون…) — تُنشأ في فليفرز قبل المنتجات، ويمكن استخدام اسمها مباشرة في ورقة Recipes. الأسماء الموجودة مسبقاً تُتخطى.",
        "New ingredients: list them in the Ingredients sheet (name, storage and recipe units, stock…) — they are created in Flavours before the products, and their names can be used directly in the Recipes sheet. Existing names are skipped.")]);
      out.getRow(1).font = { bold: true, size: 13 };
      continue;
    }
    const header = (rows[0] || []).filter((h) => h !== null).map(String);
    const notes = {};
    header.forEach((h, i) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: i })];
      const ar = cell?.c?.length ? cell.c.map((x) => x.t).join("\n") : null;
      const note = rtl ? ar : EN_NOTES[`${name}.${h}`] ?? ar;
      if (note) notes[h] = note;
    });
    if (name === "Products" || name === "Modifiers") {
      // one column per app right after `price`: that row's price in that app
      const at = header.indexOf("price") + 1 || header.length;
      const cols = [...header.slice(0, at), ...types.map((t) => t.key), ...header.slice(at)];
      for (const t of types) {
        notes[t.key] = name === "Products"
          ? L(`سعر المنتج في ${typeName(t)} (للمنتج بسعر واحد، أو لكل خياراته إن كان له خيارات) — فارغ = يُحسب من Price_Rules أو يبقى السعر الأساسي`,
            `Product price in ${typeName(t)} (for a single-price product, or for all its options if it has options) — empty = from Price_Rules, or the base price stays`)
          : L(`سعر هذا الخيار/الإضافة في ${typeName(t)} — فارغ = يُحسب من Price_Rules أو يبقى سعره الأساسي`,
            `This option's/add-on's price in ${typeName(t)} — empty = from Price_Rules, or its base price stays`);
      }
      addTable(wb, name, cols, notes);
    } else if (name === "Delivery_Prices") {
      const cols = [...FIXED_PRICE_COLS, ...types.map((t) => t.key)];
      for (const t of types) {
        notes[t.key] = L(`سعر الخيار عند الطلب عبر ${typeName(t)} — فارغ = يُحسب من Price_Rules أو يبقى السعر الأساسي (اختياري: يمكنك كتابة أسعار التطبيقات مباشرة في Products / Modifiers)`,
          `The option's price when ordered via ${typeName(t)} — empty = from Price_Rules, or the base price stays (optional: you can write app prices directly in Products / Modifiers)`);
      }
      addTable(wb, name, cols, notes);
    } else if (name === "Price_Rules") {
      addTable(wb, name, header, notes, types.map((t) => ({ payment_method_key: t.key })));
    } else {
      addTable(wb, name, header, notes);
    }
    if (name === "Recipes") addIngredientsSheet(wb);
  }
  if (!wb.getWorksheet("Ingredients")) addIngredientsSheet(wb);

  const status = (t) => (t.active === false ? L("معطّل", "Disabled") : t.adopted === false ? L("غير مسجّل", "Not registered") : L("مفعّل", "Active"));
  const H = { key: L("المفتاح (key)", "Key"), ar: L("الاسم بالعربي", "Arabic name"), en: L("الاسم بالإنجليزي", "English name"),
    status: L("الحالة", "Status"), col: L("عمود في القالب", "Column in template") };
  const listed = ctx.orderTypes.filter((t) => t.key);
  const ws = addTable(wb, "Order_Types", [H.key, H.ar, H.en, H.status, H.col], {
    [H.key]: L("اكتب هذا المفتاح (أو الاسم) كعنوان عمود في Delivery_Prices أو في payment_method_key في Price_Rules",
      "Use this key (or the name) as a column header in Delivery_Prices or as payment_method_key in Price_Rules"),
  }, listed.map((t) => ({
    [H.key]: t.key, [H.ar]: t.name_ar, [H.en]: t.name_en, [H.status]: status(t),
    [H.col]: types.includes(t) ? L("نعم", "Yes") : L("لا", "No"),
  })));
  ws.views = [{ state: "frozen", ySplit: 1, rightToLeft: rtl }];
  ws.columns.forEach((c) => { c.width = 24; });
  return wb.xlsx.writeBuffer();
}
