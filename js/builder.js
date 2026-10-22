// Validate workbook rows and turn them into Q-Flavours product payloads.
// Port of flavours/builder.py (desktop tool) — keep both in sync.

export const MODIFIER_TYPES = ["OPTION", "ADDITIONAL", "OPTION_VARIABLE", "ADDITIONAL_VARIABLE"];
const TYPE_ALIASES = {
  "خيار": "OPTION", "خيارات": "OPTION", "حجم": "OPTION", "option": "OPTION",
  "اضافه": "ADDITIONAL", "اضافات": "ADDITIONAL", "additional": "ADDITIONAL",
  "خيار متغير": "OPTION_VARIABLE", "اضافه متغيره": "ADDITIONAL_VARIABLE",
};
const YES = new Set(["yes", "y", "true", "1", "نعم", "ن", "صح", "x", "✓"]);
const NO = new Set(["no", "n", "false", "0", "لا", "خطا"]);
const NON_PRICE_COLS = new Set(["product_code", "modifier_name_en", "_row"]);

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
    throw new Error(`قيمة رقمية غير صحيحة: '${v}'`);
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
    orderTypes = [], createCategories = true } = {}) {
    Object.assign(this, { marketId, defaultBranchId, categories, ingredients, orderTypes, createCategories });
    this.pendingCategories = {};
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
    for (const o of this.orderTypes) {
      if (!o.key) continue;
      for (const v of [o.key, o.name_en, o.name_ar, o.name]) if (v && !this._price.has(keynorm(v))) this._price.set(keynorm(v), o.key);
    }
  }
  resolvePriceKey(col) {
    if (this._price.size === 0) return String(col).trim().toUpperCase(); // nothing loaded -> trust header
    return this._price.get(keynorm(col)) ?? null;
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
    if (!code) { err("Products", r._row, null, "product_code فارغ"); continue; }
    if (products.has(code)) { err("Products", r._row, code, "product_code مكرر"); continue; }
    if (!r.name_en) err("Products", r._row, code, "name_en إلزامي");
    products.set(code, r);
  }
  if (products.size === 0) err("Products", null, null, "لا توجد منتجات في ورقة Products");

  // modifiers
  const mods = new Map([...products.keys()].map((c) => [c, []]));
  for (const r of S("Modifiers")) {
    const code = codeOf(r);
    if (!products.has(code)) { err("Modifiers", r._row, code || null, "product_code غير موجود في ورقة Products"); continue; }
    const raw = r.type;
    let t = raw ? String(raw).trim().toUpperCase() : "";
    if (!MODIFIER_TYPES.includes(t)) t = TYPE_ALIASES[norm(raw)] || "";
    if (!t) { err("Modifiers", r._row, code, `type غير صحيح: '${raw}' (المسموح: ${MODIFIER_TYPES.join(", ")})`); continue; }
    if (!r.modifier_name_en && !r.modifier_name_ar) { err("Modifiers", r._row, code, "اسم الخيار فارغ"); continue; }
    mods.get(code).push({ ...r, type: t });
  }

  // price rules
  const rules = new Map();
  for (const r of S("Price_Rules")) {
    const raw = r.payment_method_key;
    if (!raw) continue;
    const key = ctx.resolvePriceKey(raw);
    if (key === null) { warn("Price_Rules", r._row, null, `'${raw}' ليس نوع طلب/تطبيق موجود في حسابك — تم تجاهله`); continue; }
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
    if (!products.has(code)) { err("Delivery_Prices", r._row, code || null, "product_code غير موجود في ورقة Products"); continue; }
    const mkey = norm(r.modifier_name_en) || "*";
    for (const [col, val] of Object.entries(r)) {
      if (NON_PRICE_COLS.has(col) || isNil(val)) continue;
      const key = ctx.resolvePriceKey(col);
      if (key === null) { warn("Delivery_Prices", r._row, code, `العمود '${col}' ليس نوع طلب/تطبيق موجود في حسابك — تم تجاهله`); continue; }
      let price;
      try { price = toNum(val); } catch (e) { err("Delivery_Prices", r._row, code, `${key}: ${e.message}`); continue; }
      if (price === null) continue;
      if (price < 0) { err("Delivery_Prices", r._row, code, `${key}: السعر سالب`); continue; }
      if (!dprices.has(code)) dprices.set(code, new Map());
      const m = dprices.get(code);
      if (!m.has(mkey)) m.set(mkey, {});
      m.get(mkey)[key] = price;
    }
  }

  // recipes: code -> modifier(norm or '*') -> [{ingredient_id, qty}]
  const recipes = new Map();
  for (const r of S("Recipes")) {
    const code = codeOf(r);
    if (!products.has(code)) { err("Recipes", r._row, code || null, "product_code غير موجود في ورقة Products"); continue; }
    const iid = ctx.ingredientId(r.ingredient);
    if (iid === null) { err("Recipes", r._row, code, `المادة الخام غير معروفة: '${r.ingredient}' — أضفها في Ingredients_Map أو استخدم رقمها`); continue; }
    let qty;
    try { qty = toNum(r.qty); } catch (e) { err("Recipes", r._row, code, e.message); continue; }
    if (!qty || qty <= 0) { err("Recipes", r._row, code, "الكمية يجب أن تكون أكبر من صفر"); continue; }
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
    if (isNil(p.category)) err("Products", row, code, "category إلزامي");
    else if (catId === null && ctx.createCategories) {
      const cname = String(p.category).trim();
      const key = norm(cname);
      if (!ctx.pendingCategories[key]) {
        const hasAr = /[؀-ۿ]/.test(cname);
        ctx.pendingCategories[key] = {
          name_en: hasAr ? (p.category_en || cname) : cname,
          name_ar: p.category_ar || cname,
        };
        warn("Products", row, code, `التصنيف '${cname}' غير موجود — سيتم إنشاؤه تلقائياً`);
      }
      catId = { __new_category__: key };
    } else if (catId === null) {
      err("Products", row, code, `التصنيف غير موجود في فليفرز: '${p.category}' — أنشئه أولاً من البرنامج`);
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
      err("Modifiers", row, code, "يجب أن يكون للمنتج خيار واحد على الأقل من نوع OPTION");
    }

    const known = new Set(modRows.map((m) => norm(m.modifier_name_en)));
    if (modRows[0]?._default) known.add("*");
    for (const src of [recipes.get(code), dprices.get(code)]) {
      if (!src) continue;
      for (const mk of src.keys()) if (mk !== "*" && !known.has(mk)) err("Recipes/Delivery_Prices", null, code, `اسم خيار غير موجود في Modifiers: '${mk}'`);
    }

    const options = [];
    for (const m of modRows) {
      const sheet = m._default ? "Products" : "Modifiers";
      let price, cost, cal, wAmt;
      try { price = toNum(m.price); cost = toNum(m.cost); cal = toNum(m.calorie); wAmt = toNum(m.weight_amount); }
      catch (e) { err(sheet, m._row, code, e.message); continue; }
      if ((price === null || price <= 0) && (m.type === "OPTION" || m.type === "ADDITIONAL")) {
        const what = m._default ? "المنتج" : `الخيار '${m.modifier_name_en}'`;
        err(sheet, m._row, code, `${what} بدون سعر أو سعره 0 — فليفرز لا يقبل سعراً أقل من أو يساوي 0. أدخل سعراً أكبر من 0`);
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
