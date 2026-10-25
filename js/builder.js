// Validate workbook rows and turn them into Q-Flavours product payloads.
// Port of flavours/builder.py (desktop tool) — keep both in sync.
import { L } from "./i18n.js";

export const MODIFIER_TYPES = ["OPTION", "ADDITIONAL", "OPTION_VARIABLE", "ADDITIONAL_VARIABLE"];
const TYPE_ALIASES = {
  "خيار": "OPTION", "خيارات": "OPTION", "حجم": "OPTION", "option": "OPTION",
  "اضافه": "ADDITIONAL", "اضافات": "ADDITIONAL", "additional": "ADDITIONAL",
  "خيار متغير": "OPTION_VARIABLE", "اضافه متغيره": "ADDITIONAL_VARIABLE",
};
const YES = new Set(["yes", "y", "true", "1", "نعم", "ن", "صح", "x", "✓"]);
const NO = new Set(["no", "n", "false", "0", "لا", "خطا"]);
const NON_PRICE_COLS = new Set(["product_code", "modifier_name_en", "_row"]);
// Regular columns of Products / Modifiers. Any other column named after an app holds that row's price in that app.
export const PRODUCT_COLS = new Set(["product_code", "name_en", "name_ar", "category", "category_ar", "category_en", "price", "cost",
  "calorie", "barcode", "is_tax_included", "description_en", "description_ar", "preparation_time", "stock", "branch_id", "_row"]);
export const MODIFIER_COLS = new Set(["product_code", "modifier_name_en", "modifier_name_ar", "type", "price", "cost", "calorie",
  "barcode", "is_tax_included", "weight_amount", "weight_unit", "_row"]);
const extraCols = (r, regular) => Object.entries(r).filter(([col, val]) => !regular.has(col) && !isNil(val));

const isNil = (v) => v === null || v === undefined;

export function norm(s) {
  if (isNil(s)) return "";
  return String(s).trim().toLowerCase()
    .replace(/[إأآا]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}
export const keynorm = (s) => norm(s).replace(/[^0-9a-z؀-ۿ]/g, "");

export function toBool(v, dflt) {
  if (isNil(v)) return dflt;
  if (typeof v === "boolean") return v;
  const s = norm(v);
  if (YES.has(s)) return true;
  if (NO.has(s)) return false;
  return dflt;
}

export function toNum(v) {
  if (isNil(v) || v === "") return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  const s = String(v).replace(/,/g, "").replace(/٫/g, ".").trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) {
    throw new Error(L(`قيمة رقمية غير صحيحة: '${v}'`, `Invalid number: '${v}'`));
  }
  return parseFloat(s);
}
const safeNum = (v) => { try { return toNum(v); } catch { return null; } };

export function cleanNum(x) {
  if (isNil(x)) return null;
  const r = Math.round(x * 10000) / 10000;
  return r;
}
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export function roundTo(value, step) {
  if (!step) return round2(value);
  return round2(Math.ceil(Math.round((value / step) * 1e6) / 1e6) * step); // round up to the step
}
const isIntLike = (v) => { const f = parseFloat(v); return !Number.isNaN(f) && Number.isInteger(f) && String(v).trim() !== ""; };
const intLike = (v) => (isIntLike(v) ? parseInt(parseFloat(v), 10) : v);

export class Context {
  constructor({ marketId = null, defaultBranchId = null, categories = [], ingredients = [],
    orderTypes = [], orderTypeCatalog = null, createCategories = true, createOrderTypes = true } = {}) {
    Object.assign(this, { marketId, defaultBranchId, categories, ingredients, orderTypes, orderTypeCatalog, createCategories, createOrderTypes });
    this.pendingCategories = {};
    this.pendingOrderTypes = [];  // apps named in the file that this run will register (see uploader.planOrderTypes)
    this.reindex();
  }
  reindex() {
    this._cat = new Map();
    for (const c of this.categories) {
      for (const k of ["name_en", "name_ar"]) if (c[k] && !this._cat.has(norm(c[k]))) this._cat.set(norm(c[k]), c.id);
      if (!this._cat.has(norm(c.id))) this._cat.set(norm(c.id), c.id);
    }
    this._ing = new Map();
    for (const i of this.ingredients) {
      for (const k of ["name_en", "name_ar"]) if (i[k] && !this._ing.has(norm(i[k]))) this._ing.set(norm(i[k]), i.id);
      if (!this._ing.has(norm(i.id))) this._ing.set(norm(i.id), i.id);
    }
    this._price = new Map();
    for (const o of [...this.orderTypes, ...this.pendingOrderTypes]) {
      if (!o.key) continue;
      for (const v of [o.key, o.name_en, o.name_ar, o.name]) if (v && !this._price.has(keynorm(v))) this._price.set(keynorm(v), o.key);
    }
  }
  resolvePriceKey(col) {
    if (this._price.size === 0 && !this.orderTypeCatalog) return String(col).trim().toUpperCase(); // nothing loaded -> trust header
    return this._price.get(keynorm(col)) ?? null;
  }
  // Like resolvePriceKey but never trusts an unknown header: used for the extra columns of Products / Modifiers,
  // where a stray column (notes, …) must not turn into an app.
  knownPriceKey(col) { return this._price.get(keynorm(col)) ?? null; }
  orderType(key) { return this.orderTypes.find((o) => o.key === key) || null; }
  // A type Flavours knows (registered here or not), matched by key or name like the price columns are.
  catalogType(name) {
    const k = keynorm(name);
    return (this.orderTypeCatalog || []).find((o) => [o.key, o.name_en, o.name_ar].some((v) => v && keynorm(v) === k)) || null;
  }
  addIngredientMap(rows) {
    for (const r of rows) if (!isNil(r.ingredient_name) && !isNil(r.ingredient_id)) this._ing.set(norm(r.ingredient_name), intLike(r.ingredient_id));
  }
  categoryId(v) { return isNil(v) ? null : (this._cat.get(norm(v)) ?? null); }
  ingredientId(v) {
    if (isNil(v)) return null;
    const hit = this._ing.get(norm(v));
    if (!isNil(hit)) return intLike(hit);
    return isIntLike(v) ? parseInt(parseFloat(v), 10) : null;
  }
}

// Names the file uses as apps/order types: Delivery_Prices columns that hold a price, Price_Rules keys
// that carry a rule (a key with every rule cell empty changes nothing, so it does not count), and extra
// Products / Modifiers columns that name a type Flavours knows (a new custom app needs a Delivery_Prices column).
export function priceColumnNames(sheets, ctx) {
  const names = new Set();
  for (const r of sheets.Delivery_Prices || []) {
    for (const [col, val] of Object.entries(r)) if (!NON_PRICE_COLS.has(col) && !isNil(val)) names.add(String(col).trim());
  }
  for (const [sheet, regular] of [["Products", PRODUCT_COLS], ["Modifiers", MODIFIER_COLS]]) {
    for (const r of sheets[sheet] || []) {
      for (const [col] of extraCols(r, regular)) if (ctx.knownPriceKey(col) !== null || ctx.catalogType(col)) names.add(String(col).trim());
    }
  }
  for (const r of sheets.Price_Rules || []) {
    if (!isNil(r.payment_method_key) && [r.markup_percent, r.fixed_add, r.round_to].some((v) => !isNil(v))) names.add(String(r.payment_method_key).trim());
  }
  return [...names];
}

export function buildPayloads(sheets, ctx) {
  const issues = [];
  const err = (sheet, row, code, message) => issues.push({ level: "ERROR", sheet, row, product_code: code, message });
  const warn = (sheet, row, code, message) => issues.push({ level: "WARNING", sheet, row, product_code: code, message });
  const S = (name) => sheets[name] || [];
  const codeOf = (r) => String(r.product_code ?? "").trim();

  ctx.addIngredientMap(S("Ingredients_Map"));

  // products
  const products = new Map();
  for (const r of S("Products")) {
    const code = codeOf(r);
    if (!code) { err("Products", r._row, null, L("product_code فارغ", "product_code is empty")); continue; }
    if (products.has(code)) { err("Products", r._row, code, L("product_code مكرر", "Duplicate product_code")); continue; }
    if (!r.name_en) err("Products", r._row, code, L("name_en إلزامي", "name_en is required"));
    products.set(code, r);
  }
  if (products.size === 0) err("Products", null, null, L("لا توجد منتجات في ورقة Products", "No products in the Products sheet"));

  // modifiers
  const mods = new Map([...products.keys()].map((c) => [c, []]));
  for (const r of S("Modifiers")) {
    const code = codeOf(r);
    if (!products.has(code)) { err("Modifiers", r._row, code || null, L("product_code غير موجود في ورقة Products", "product_code not found in the Products sheet")); continue; }
    const raw = r.type;
    let t = raw ? String(raw).trim().toUpperCase() : "";
    if (!MODIFIER_TYPES.includes(t)) t = TYPE_ALIASES[norm(raw)] || "";
    if (!t) { err("Modifiers", r._row, code, L(`type غير صحيح: '${raw}' (المسموح: ${MODIFIER_TYPES.join(", ")})`, `Invalid type: '${raw}' (allowed: ${MODIFIER_TYPES.join(", ")})`)); continue; }
    if (!r.modifier_name_en && !r.modifier_name_ar) { err("Modifiers", r._row, code, L("اسم الخيار فارغ", "Option name is empty")); continue; }
    mods.get(code).push({ ...r, type: t });
  }

  // price rules
  const rules = new Map();
  for (const r of S("Price_Rules")) {
    const raw = r.payment_method_key;
    if (!raw) continue;
    const key = ctx.resolvePriceKey(raw);
    if (key === null) { warn("Price_Rules", r._row, null, L(`'${raw}' ليس نوع طلب/تطبيق موجود في حسابك — تم تجاهله`, `'${raw}' is not an order type/app in your account — ignored`)); continue; }
    try {
      rules.set(key, {
        pct: toNum(r.markup_percent) || 0, add: toNum(r.fixed_add) || 0,
        step: toNum(r.round_to), applies: String(r.applies_to || "ALL").trim().toUpperCase(),
      });
    } catch (e) { err("Price_Rules", r._row, null, e.message); }
  }

  // explicit channel prices: code -> modifier(norm or '*') -> key -> price
  const dprices = new Map();
  for (const r of S("Delivery_Prices")) {
    const code = codeOf(r);
    if (!products.has(code)) { err("Delivery_Prices", r._row, code || null, L("product_code غير موجود في ورقة Products", "product_code not found in the Products sheet")); continue; }
    const mkey = norm(r.modifier_name_en) || "*";
    for (const [col, val] of Object.entries(r)) {
      if (NON_PRICE_COLS.has(col) || isNil(val)) continue;
      const key = ctx.resolvePriceKey(col);
      if (key === null) { warn("Delivery_Prices", r._row, code, L(`العمود '${col}' ليس نوع طلب/تطبيق موجود في حسابك — تم تجاهله`, `Column '${col}' is not an order type/app in your account — ignored`)); continue; }
      let price;
      try { price = toNum(val); } catch (e) { err("Delivery_Prices", r._row, code, `${key}: ${e.message}`); continue; }
      if (price === null) continue;
      if (price < 0) { err("Delivery_Prices", r._row, code, `${key}: ${L("السعر سالب", "negative price")}`); continue; }
      if (!dprices.has(code)) dprices.set(code, new Map());
      const m = dprices.get(code);
      if (!m.has(mkey)) m.set(mkey, {});
      m.get(mkey)[key] = price;
    }
  }

  // app prices written next to the price: Products row = the whole product ('*'), Modifiers row = that option.
  // They win over a Delivery_Prices value for the same option and app (with a warning if the two differ).
  const inline = (sheet, r, code, mkey, regular) => {
    for (const [col, val] of extraCols(r, regular)) {
      const key = ctx.knownPriceKey(col);
      if (key === null) {
        let num = null;
        try { num = toNum(val); } catch { /* text column: not a price */ }
        if (num !== null) warn(sheet, r._row, code, L(`العمود '${col}' ليس تطبيقاً/نوع طلب في حسابك ولا يعرفه فليفرز — تم تجاهله (لتطبيق جديد أضف عموداً باسمه في Delivery_Prices)`, `Column '${col}' is not an app/order type in your account and Flavours doesn't know it — ignored (for a new app, add a column with its name in Delivery_Prices)`));
        continue;
      }
      let price;
      try { price = toNum(val); } catch (e) { err(sheet, r._row, code, `${key}: ${e.message}`); continue; }
      if (price === null) continue;
      if (price < 0) { err(sheet, r._row, code, `${key}: ${L("السعر سالب", "negative price")}`); continue; }
      if (!dprices.has(code)) dprices.set(code, new Map());
      const m = dprices.get(code);
      if (!m.has(mkey)) m.set(mkey, {});
      const prev = m.get(mkey)[key];
      if (prev !== undefined && prev !== price) warn(sheet, r._row, code, L(`${key}: السعر ${price} يختلف عن ${prev} في Delivery_Prices — اعتُمد ${price}`, `${key}: price ${price} differs from ${prev} in Delivery_Prices — ${price} was used`));
      m.get(mkey)[key] = price;
    }
  };
  for (const r of S("Products")) {
    const code = codeOf(r);
    if (products.has(code)) inline("Products", r, code, "*", PRODUCT_COLS);
  }
  for (const r of S("Modifiers")) {
    const code = codeOf(r);
    if (products.has(code) && !isNil(r.modifier_name_en)) inline("Modifiers", r, code, norm(r.modifier_name_en), MODIFIER_COLS);
  }

  // recipes: code -> modifier(norm or '*') -> [{ingredient_id, qty}]
  const recipes = new Map();
  for (const r of S("Recipes")) {
    const code = codeOf(r);
    if (!products.has(code)) { err("Recipes", r._row, code || null, L("product_code غير موجود في ورقة Products", "product_code not found in the Products sheet")); continue; }
    const iid = ctx.ingredientId(r.ingredient);
    if (iid === null) { err("Recipes", r._row, code, L(`المادة الخام غير معروفة: '${r.ingredient}' — أضفها في Ingredients_Map أو استخدم رقمها`, `Unknown ingredient: '${r.ingredient}' — add it to Ingredients_Map or use its ID`)); continue; }
    let qty;
    try { qty = toNum(r.qty); } catch (e) { err("Recipes", r._row, code, e.message); continue; }
    if (!qty || qty <= 0) { err("Recipes", r._row, code, L("الكمية يجب أن تكون أكبر من صفر", "Quantity must be greater than zero")); continue; }
    const mkey = norm(r.modifier_name_en) || "*";
    if (!recipes.has(code)) recipes.set(code, new Map());
    const m = recipes.get(code);
    if (!m.has(mkey)) m.set(mkey, []);
    m.get(mkey).push({ ingredient_id: iid, qty: cleanNum(qty) });
  }

  // assemble
  const built = [];
  ctx.pendingCategories = {};
  for (const [code, p] of products) {
    const row = p._row;
    let catId = ctx.categoryId(p.category);
    if (isNil(p.category)) err("Products", row, code, L("category إلزامي", "category is required"));
    else if (catId === null && ctx.createCategories) {
      const cname = String(p.category).trim();
      const key = norm(cname);
      if (!ctx.pendingCategories[key]) {
        const hasAr = /[؀-ۿ]/.test(cname);
        ctx.pendingCategories[key] = {
          name_en: hasAr ? (p.category_en || cname) : cname,
          name_ar: p.category_ar || cname,
        };
        warn("Products", row, code, L(`التصنيف '${cname}' غير موجود — سيتم إنشاؤه تلقائياً`, `Category '${cname}' doesn't exist — it will be created automatically`));
      }
      catId = { __new_category__: key };
    } else if (catId === null) {
      err("Products", row, code, L(`التصنيف غير موجود في فليفرز: '${p.category}' — أنشئه أولاً من البرنامج`, `Category not found in Flavours: '${p.category}' — create it there first`));
    }
    const taxDefault = toBool(p.is_tax_included, true);

    let modRows = mods.get(code) || [];
    if (modRows.length === 0) {
      let price = null;
      try { price = toNum(p.price); } catch (e) { err("Products", row, code, `price: ${e.message}`); }
      modRows = [{
        _row: row, modifier_name_en: p.name_en, modifier_name_ar: p.name_ar, type: "OPTION", price,
        cost: p.cost, calorie: p.calorie, barcode: p.barcode, is_tax_included: p.is_tax_included, _default: true,
      }];
    }
    if (!modRows.some((m) => m.type === "OPTION" || m.type === "OPTION_VARIABLE")) {
      err("Modifiers", row, code, L("يجب أن يكون للمنتج خيار واحد على الأقل من نوع OPTION", "The product needs at least one OPTION"));
    }

    const known = new Set(modRows.map((m) => norm(m.modifier_name_en)));
    if (modRows[0]?._default) known.add("*");
    for (const src of [recipes.get(code), dprices.get(code)]) {
      if (!src) continue;
      for (const mk of src.keys()) if (mk !== "*" && !known.has(mk)) err("Recipes/Delivery_Prices", null, code, L(`اسم خيار غير موجود في Modifiers: '${mk}'`, `Option name not found in Modifiers: '${mk}'`));
    }

    const options = [];
    for (const m of modRows) {
      const sheet = m._default ? "Products" : "Modifiers";
      let price, cost, cal, wAmt;
      try { price = toNum(m.price); cost = toNum(m.cost); cal = toNum(m.calorie); wAmt = toNum(m.weight_amount); }
      catch (e) { err(sheet, m._row, code, e.message); continue; }
      if ((price === null || price <= 0) && (m.type === "OPTION" || m.type === "ADDITIONAL")) {
        const what = m._default ? L("المنتج", "the product") : L(`الخيار '${m.modifier_name_en}'`, `option '${m.modifier_name_en}'`);
        err(sheet, m._row, code, L(`${what} بدون سعر أو سعره 0 — فليفرز لا يقبل سعراً أقل من أو يساوي 0. أدخل سعراً أكبر من 0`, `${what} has no price or a price of 0 — Flavours doesn't accept a price of 0 or less. Enter a price greater than 0`));
        continue;
      }
      const mk = norm(m.modifier_name_en);

      // recipe
      const rec = recipes.get(code);
      let ing = rec?.get(mk);
      if (!ing && (m.type === "OPTION" || m.type === "OPTION_VARIABLE" || m._default)) ing = rec?.get("*");

      // per order type final prices
      const dp = dprices.get(code);
      const explicit = { ...(dp?.get("*") || {}), ...(dp?.get(mk) || {}) };
      const finals = {};
      if (price !== null) {
        for (const [key, rule] of rules) {
          if (key in explicit) continue;
          if (rule.applies !== "ALL" && !m.type.startsWith(rule.applies)) continue;
          if (rule.pct === 0 && rule.add === 0) continue;
          finals[key] = roundTo(price * (1 + rule.pct / 100) + rule.add, rule.step);
        }
        Object.assign(finals, explicit);
        // Flavours stores an app price as an amount ADDED to the base price and rejects a negative one (HTTP 422).
        const what = m._default ? L("المنتج", "the product") : L(`الخيار '${m.modifier_name_en}'`, `option '${m.modifier_name_en}'`);
        for (const [key, v] of Object.entries(finals)) {
          if (v < price) err(sheet, m._row, code, L(`سعر ${what} في ${key} (${v}) أقل من سعره الأساسي (${price}) — فليفرز لا يقبل سعر تطبيق أقل من السعر الأساسي. اكتب سعراً مساوياً أو أعلى، أو اترك الخانة فارغة`, `Price of ${what} in ${key} (${v}) is below its base price (${price}) — Flavours doesn't accept an app price below the base price. Enter an equal or higher price, or leave the cell empty`));
        }
      }

      let barcode = null;
      if (!isNil(m.barcode)) barcode = typeof m.barcode === "number" && Number.isInteger(m.barcode) ? String(m.barcode) : String(m.barcode);
      const stock = safeNum(p.stock);
      const o = {
        name_en: m.modifier_name_en || m.modifier_name_ar,
        name_ar: m.modifier_name_ar || m.modifier_name_en,
        type: m.type, pricing_type: m.type,
        price: cleanNum(price), cost: cleanNum(cost), calorie: cal === null ? null : Math.trunc(cal),
        is_tax_included: toBool(m.is_tax_included, taxDefault) ? 1 : 0,
        has_weight: wAmt === null ? 0 : 1, weight_amount: cleanNum(wAmt), weight_unit: wAmt === null ? null : (m.weight_unit ?? null),
        has_stock: stock === null ? 0 : 1, stock: stock === null ? null : Math.trunc(stock),
        barcode,
        ingredients: ing ? mergeIngredients(ing) : [],
        // Q-Flavours stores per-order-type prices as an amount ADDED to the base price.
        prices: price === null ? [] : Object.entries(finals)
          .map(([k, v]) => ({ priceable_type: "ORDER_TYPE", priceable_id: k, value_type: "NOMINAL", value: cleanNum(round2(v - price)) }))
          .filter((x) => x.value !== 0),
      };
      options.push(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)));
    }

    const branchId = p.branch_id || ctx.defaultBranchId || null;
    const prep = safeNum(p.preparation_time);
    const body = Object.fromEntries(Object.entries({
      market_id: ctx.marketId, branch_id: branchId,
      name_en: p.name_en, name_ar: p.name_ar ?? null,
      description_en: p.description_en ?? null, description_ar: p.description_ar ?? null,
      category_id: catId, product_category_id: catId,
      duration: prep ? Math.trunc(prep) : null,
      options, modifiers: options,
    }).filter(([, v]) => v !== null && v !== undefined));
    built.push({ code, row, name_en: p.name_en || "", body, branch_id: branchId });
  }
  // any error for a product blocks that product (never upload a partial menu item)
  const bad = new Set(issues.filter((i) => i.level === "ERROR").map((i) => i.product_code));
  return { built: built.filter((b) => !bad.has(b.code)), issues };
}

function mergeIngredients(items) {
  const m = new Map();
  for (const it of items) m.set(it.ingredient_id, (m.get(it.ingredient_id) || 0) + it.qty);
  return [...m].map(([ingredient_id, qty]) => ({ ingredient_id, qty: cleanNum(qty) }));
}
