// Orchestrates: connect -> load reference data -> validate -> create categories and apps -> upload -> report.
import { Client, ApiError } from "./api.js";
import { Context, NEW_INGREDIENT, buildPayloads, keynorm, norm, priceColumnNames } from "./builder.js";
import { L } from "./i18n.js";

export const MODES = {
  upsert: ["إنشاء الجديد وتحديث الموجود (بنفس الاسم الإنجليزي)", "Create new and update existing (same English name)"],
  create_only: ["إنشاء الجديد فقط وتخطي الموجود", "Create new only, skip existing"],
  always_create: ["إنشاء الكل حتى لو كان الاسم موجوداً", "Create all, even if the name exists"],
};

export async function connect(token, baseUrl, log) {
  const client = new Client(token, baseUrl, { log });
  let me;
  try { me = await client.me(); }
  catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw new ApiError(`${e.message}\n${L("المفتاح غير مقبول (جُرّب بطريقتي Bearer و API-TOKEN). تأكد من نسخه كاملاً، ومن أنه مفعّل للاستخدام عبر الـ API.", "The key was refused (tried both Bearer and API-TOKEN). Make sure it's copied in full and enabled for API use.")}`, e.status);
    }
    throw e;
  }
  log(`${L("✓ متصل", "✓ Connected")}: ${client.baseUrl}${client.viaProxy ? L(" (عبر خادم الموقع — API-TOKEN)", " (via this site's server — API-TOKEN)") : L(" (Bearer مباشرة)", " (Bearer, direct)")}`);
  return { client, me };
}

export async function loadContext(client, me, { marketId, branchId } = {}, log) {
  marketId = marketId || Client.marketIdOf(me);
  branchId = branchId || Client.branchIdOf(me);
  if (!marketId) log(L("⚠️ لم يتم العثور على market_id — أدخله يدوياً", "⚠️ market_id not found — enter it manually"));
  log(`• Market: ${marketId}  • Branch: ${branchId || "-"}`);
  const [categories, { orderTypes, catalog }, ingredients] = await Promise.all([
    client.categories(marketId), loadOrderTypes(client), client.ingredients(marketId),
  ]);
  log(`• ${L("التصنيفات", "Categories")}: ${categories.length}`);
  const typeList = orderTypes.map((o) => o.key + (L(o.name_ar, o.name_en) ? ` (${L(o.name_ar, o.name_en)})` : "") + (o.adopted && !o.active ? L(" — معطّل", " — disabled") : ""));
  log(`• ${L("أنواع الطلب/التطبيقات المسجلة", "Registered order types/apps")}: ${typeList.join(L("، ", ", ")) || L("لا يوجد", "none")}`);
  log(`• ${L("المواد الخام المعروفة", "Known ingredients")}: ${ingredients.length}`);
  return new Context({ marketId, defaultBranchId: branchId, categories, ingredients, orderTypes, orderTypeCatalog: catalog });
}

async function loadOrderTypes(client) {
  try {
    const catalog = await client.orderTypeCatalog();
    if (catalog) return { orderTypes: catalog.filter((t) => t.adopted), catalog };
  } catch { /* older API */ }
  return { orderTypes: await client.legacyOrderTypes(), catalog: null };
}

// Apps named in the file that the account doesn't have yet. A type Flavours already knows (e.g. HUNGERSTATION)
// gets adopted under its own key; any other name becomes a new custom type, whose key is only known after it is
// created, so it gets a placeholder key until then. Pending types join the lookup so their prices are built.
function planOrderTypes(sheets, ctx, log) {
  ctx.pendingOrderTypes = [];
  ctx.reindex();
  if (!ctx.orderTypeCatalog) return [];
  const plan = new Map();
  const warned = new Set();
  for (const name of priceColumnNames(sheets, ctx)) {
    const key = ctx.resolvePriceKey(name);
    if (key !== null) {
      const t = ctx.orderType(key);
      if (t && t.adopted && !t.active && !warned.has(key)) { warned.add(key); log(L(`⚠️ التطبيق ${t.name_ar || t.key} مسجّل لكنه معطّل في حسابك — فعّله من إعدادات فليفرز ليظهر سعره`, `⚠️ The app ${t.name_en || t.key} is registered but disabled in your account — enable it in Flavours settings for its price to show`)); }
      continue;
    }
    if (!ctx.createOrderTypes) continue;
    const known = ctx.catalogType(name);
    const planned = known ? known.key : `NEW:${keynorm(name)}`;
    if (!plan.has(planned)) plan.set(planned, { key: planned, name, known });
  }
  ctx.pendingOrderTypes = [...plan.values()].map((t) => ({ key: t.key, name_en: t.name, name_ar: t.known?.name_ar ?? null, name: t.known?.name_en ?? null }));
  ctx.reindex();
  return [...plan.values()];
}

const appLabel = (t) => L(t.known.name_ar, t.known.name_en) || t.known.name_en || t.known.name_ar || t.key;

// Registers the planned apps, then points every built price at the real key (or drops it if that app failed).
// realKey: planned key -> real key; null = failed; undefined = created but the API didn't say its key.
async function createOrderTypes(client, ctx, plan, built, log) {
  const realKey = {};
  for (const t of plan) {
    try {
      const key = await client.createOrderType(t.known
        ? { type_key: t.key, name_en: t.known.name_en || t.key, name_ar: t.known.name_ar }
        : { name_en: t.name, name_ar: t.name });
      realKey[t.key] = t.known ? t.key : key || undefined;
      log(t.known ? L(`🆕 تم تفعيل التطبيق ${appLabel(t)} (${t.key}) في حسابك`, `🆕 Enabled the app ${appLabel(t)} (${t.key}) in your account`)
        : L(`🆕 تم إنشاء نوع الطلب: ${t.name}`, `🆕 Created the order type: ${t.name}`));
    } catch (e) {
      realKey[t.key] = null;
      log(t.known ? L(`❌ فشل تفعيل التطبيق ${appLabel(t)}: ${e.message} — لن تُرفع أسعاره`, `❌ Could not enable the app ${appLabel(t)}: ${e.message} — its prices won't be uploaded`)
        : L(`❌ فشل إنشاء نوع الطلب ${t.name}: ${e.message} — لن تُرفع أسعاره`, `❌ Could not create the order type ${t.name}: ${e.message} — its prices won't be uploaded`));
    }
  }
  try {
    ctx.orderTypes = await client.orderTypes();
    for (const t of plan) {
      if (t.known || realKey[t.key] === null || realKey[t.key]) continue;
      const k = keynorm(t.name);
      realKey[t.key] = ctx.orderTypes.find((o) => [o.name_en, o.name_ar].some((v) => v && keynorm(v) === k))?.key || null;
      if (!realKey[t.key]) log(L(`❌ أُنشئ نوع الطلب ${t.name} لكن تعذّر معرفة مفتاحه — لن تُرفع أسعاره`, `❌ The order type ${t.name} was created but its key couldn't be found — its prices won't be uploaded`));
    }
  } catch (e) { log(L(`⚠️ تعذّر تحديث قائمة أنواع الطلب: ${e.message}`, `⚠️ Could not refresh the order type list: ${e.message}`)); }
  for (const b of built) {
    for (const o of b.body.options || []) {
      if (!o.prices?.length) continue;
      o.prices = o.prices
        .filter((p) => !(p.priceable_id in realKey) || realKey[p.priceable_id])
        .map((p) => (p.priceable_id in realKey ? { ...p, priceable_id: realKey[p.priceable_id] } : p));
    }
  }
}

// Creates the Ingredients sheet's new ingredients, then swaps the recipes' placeholder ids for the real ones.
// Returns a report row per ingredient and the failed ones (key -> message); a recipe still holding a placeholder
// after this means its ingredient failed, and the uploader fails that product.
async function createIngredients(client, ctx, built, log) {
  const rows = [], failed = {}, realId = {};
  for (const [key, spec] of Object.entries(ctx.pendingIngredients)) {
    const row = { name_en: spec.name_en, name_ar: spec.name_ar, storage_unit: spec.source_unit, recipe_unit: spec.target_unit,
      storage_ratio: spec.source_rate, recipe_ratio: spec.target_rate, stock: spec.stock, status: "", flavours_id: null, message: "" };
    try {
      realId[key] = await client.createIngredient(spec);
      row.status = "OK";
      log(L(`🆕 تم إنشاء المادة الخام: ${spec.name_en} / ${spec.name_ar}`, `🆕 Created the ingredient: ${spec.name_en} / ${spec.name_ar}`));
    } catch (e) {
      failed[key] = row.message = e.message;
      row.status = "FAILED";
      log(L(`❌ فشل إنشاء المادة الخام ${spec.name_en}: ${e.message}`, `❌ Could not create the ingredient ${spec.name_en}: ${e.message}`));
    }
    rows.push({ key, row });
  }
  // the API may not return the new id: look it up by name
  if (rows.some(({ key, row }) => row.status === "OK" && isNil(realId[key]))) {
    try {
      ctx.ingredients = await client.ingredients(ctx.marketId);
      ctx.reindex();
      for (const { key, row } of rows) if (row.status === "OK" && isNil(realId[key])) realId[key] = ctx.ingredientId(row.name_en);
    } catch (e) { log(L(`⚠️ تعذّر تحديث قائمة المواد الخام: ${e.message}`, `⚠️ Could not refresh the ingredient list: ${e.message}`)); }
  }
  for (const { key, row } of rows) {
    if (row.status !== "OK") continue;
    const id = realId[key];
    if (isNil(id) || String(id).startsWith(NEW_INGREDIENT)) {
      failed[key] = row.message = L("أُنشئت لكن تعذّر معرفة رقمها — لم تُربط بالوصفات", "Created, but its ID couldn't be found — not linked to recipes");
      log(`⚠️ ${row.name_en}: ${row.message}`);
    } else row.flavours_id = id;
  }
  for (const b of built) {
    for (const o of b.body.options || []) {
      for (const i of o.ingredients || []) {
        const key = isPending(i.ingredient_id) ? i.ingredient_id.slice(NEW_INGREDIENT.length) : null;
        if (key !== null && !(key in failed) && !isNil(realId[key])) i.ingredient_id = realId[key];
      }
    }
  }
  return { rows: rows.map((r) => r.row), failed };
}
const isNil = (v) => v === null || v === undefined;
const isPending = (id) => typeof id === "string" && id.startsWith(NEW_INGREDIENT);
// names of the not-created ingredients a product's recipes still point at
const missingIngredients = (body, ctx) => [...new Set((body.options || []).flatMap((o) => (o.ingredients || [])
  .filter((i) => isPending(i.ingredient_id)).map((i) => ctx.pendingIngredients[i.ingredient_id.slice(NEW_INGREDIENT.length)]?.name_en ?? i.ingredient_id)))];

export async function referenceSheets(client, ctx) {
  const products = await client.products(ctx.marketId);
  return {
    Categories: ctx.categories.map((c) => ({ id: c.id, name_en: c.name_en, name_ar: c.name_ar })),
    Order_Types: ctx.orderTypes,
    Ingredients: ctx.ingredients,
    Products: products.map((p) => ({ id: p.id, name_en: p.name_en, name_ar: p.name_ar, category_id: p.category_id ?? p.product_category_id, branch_id: p.branch_id, is_active: p.is_active })),
  };
}

export async function upload(client, ctx, sheets, { mode = "upsert", dryRun = true, allowPartial = false, log, progress = () => {} }) {
  const typePlan = planOrderTypes(sheets, ctx, log);
  const { built, issues } = buildPayloads(sheets, ctx);
  const errors = issues.filter((i) => i.level === "ERROR");
  for (const i of issues) log(`${i.level === "ERROR" ? "❌" : "⚠️"} [${i.sheet}${i.row ? ":" + i.row : ""}] ${i.product_code || ""} ${i.message}`);
  log(L(`• منتجات جاهزة: ${built.length} | أخطاء: ${errors.length} | تحذيرات: ${issues.length - errors.length}`, `• Ready products: ${built.length} | errors: ${errors.length} | warnings: ${issues.length - errors.length}`));

  const blocked = errors.length > 0 && !dryRun && !allowPartial;
  if (blocked) log(L("⛔ يوجد أخطاء في الملف — لم يتم رفع أي منتج. صحّح الأخطاء أو فعّل خيار رفع المنتجات السليمة فقط.", "⛔ The file has errors — no product was uploaded. Fix the errors or turn on uploading only the valid products."));

  // create missing categories (live only) and plug their ids into the payloads
  const catFailed = {};
  const isNew = (v) => v && typeof v === "object" && "__new_category__" in v;
  const used = [...new Set(built.filter((b) => isNew(b.body.category_id)).map((b) => b.body.category_id.__new_category__))];
  if (used.length && !blocked) {
    if (dryRun) used.forEach((k) => log(`${L("🆕 سيتم إنشاء التصنيف", "🆕 Will create the category")}: ${ctx.pendingCategories[k].name_en} / ${ctx.pendingCategories[k].name_ar}`));
    else {
      const created = {};
      for (const k of used) {
        const c = ctx.pendingCategories[k];
        try {
          const d = await client.createCategory(c.name_en, c.name_ar, ctx.marketId);
          created[k] = d.id;
          ctx.categories.push(d);
          log(d._existing ? L(`✓ التصنيف موجود مسبقاً: ${c.name_en} (ID ${d.id}) — تم الربط به`, `✓ Category already exists: ${c.name_en} (ID ${d.id}) — linked to it`)
            : L(`🆕 تم إنشاء التصنيف: ${c.name_en} (ID ${d.id})`, `🆕 Created the category: ${c.name_en} (ID ${d.id})`));
        } catch (e) { catFailed[k] = e.message; log(L(`❌ فشل إنشاء التصنيف ${c.name_en}: ${e.message}`, `❌ Could not create the category ${c.name_en}: ${e.message}`)); }
      }
      for (const b of built) {
        const pc = b.body.category_id;
        if (isNew(pc) && pc.__new_category__ in created) b.body.category_id = b.body.product_category_id = created[pc.__new_category__];
      }
      ctx.reindex();
    }
  }

  // register missing apps (live only) and point their prices at the real keys
  if (typePlan.length && !blocked) {
    if (dryRun) typePlan.forEach((t) => log(t.known ? L(`🆕 سيتم تفعيل التطبيق ${appLabel(t)} (${t.key}) في حسابك`, `🆕 Will enable the app ${appLabel(t)} (${t.key}) in your account`)
      : L(`🆕 سيتم إنشاء نوع طلب جديد في حسابك: ${t.name}`, `🆕 Will create a new order type in your account: ${t.name}`)));
    else await createOrderTypes(client, ctx, typePlan, built, log);
  }
  ctx.pendingOrderTypes = [];
  ctx.reindex();

  // create the Ingredients sheet's new ingredients (live only) before the products whose recipes use them
  let ingredientRows = [], ingFailed = {};
  const newIngs = Object.values(ctx.pendingIngredients);
  if (newIngs.length && !blocked) {
    if (dryRun) {
      newIngs.forEach((s) => log(L(`🆕 سيتم إنشاء المادة الخام: ${s.name_en} / ${s.name_ar} (${s.source_rate} ${s.source_unit} = ${s.target_rate} ${s.target_unit})`,
        `🆕 Will create the ingredient: ${s.name_en} / ${s.name_ar} (${s.source_rate} ${s.source_unit} = ${s.target_rate} ${s.target_unit})`)));
      ingredientRows = newIngs.map((s) => ({ name_en: s.name_en, name_ar: s.name_ar, storage_unit: s.source_unit, recipe_unit: s.target_unit,
        storage_ratio: s.source_rate, recipe_ratio: s.target_rate, stock: s.stock, status: "DRY-RUN", flavours_id: null, message: "" }));
    } else ({ rows: ingredientRows, failed: ingFailed } = await createIngredients(client, ctx, built, log));
  }

  const existing = new Map();
  if (mode !== "always_create") {
    for (const p of await client.products(ctx.marketId)) {
      if (!p.name_en) continue;
      const k = norm(p.name_en);
      if (!existing.has(`${k}|${p.branch_id ?? ""}`)) existing.set(`${k}|${p.branch_id ?? ""}`, p);
      if (!existing.has(`${k}|*`)) existing.set(`${k}|*`, p);
    }
  }

  const results = [];
  let n = 0;
  for (const bp of built) {
    progress(++n, built.length);
    const k = norm(bp.name_en);
    const match = existing.get(`${k}|${bp.branch_id ?? ""}`) || existing.get(`${k}|*`);
    const action = match ? (mode === "create_only" ? "skip" : "update") : "create";
    const res = { product_code: bp.code, name_en: bp.name_en, action, status: "", flavours_id: match?.id ?? null,
      options: bp.body.options?.length ?? 0, message: "", payload: JSON.stringify(bp.body) };
    const pc = bp.body.category_id;
    const missing = dryRun || blocked ? [] : missingIngredients(bp.body, ctx);
    if (blocked) res.status = "BLOCKED";
    else if (missing.length) { res.status = "FAILED"; res.message = L(`فشل إنشاء المادة الخام: ${missing.join("، ")}`, `Could not create the ingredient: ${missing.join(", ")}`); }
    else if (!dryRun && isNew(pc)) { res.status = "FAILED"; res.message = L("فشل إنشاء التصنيف: ", "Could not create the category: ") + (catFailed[pc.__new_category__] || ""); }
    else if (dryRun || action === "skip") res.status = dryRun ? "DRY-RUN" : "SKIPPED";
    else {
      try {
        const body = action === "create" ? bp.body : Object.fromEntries(Object.entries(bp.body).filter(([key]) => key !== "market_id"));
        const d = action === "create" ? await client.createProduct(body) : await client.updateProduct(match.id, body);
        res.status = "OK";
        res.flavours_id = d?.id ?? res.flavours_id;
      } catch (e) { res.status = "FAILED"; res.message = e.message; }
    }
    const icon = { OK: "✅", "DRY-RUN": "✅", SKIPPED: "⏭️" }[res.status] || "❌";
    log(`${icon} ${bp.code} ${bp.name_en} → ${action} ${res.status} ${res.message}`);
    results.push(res);
  }
  return {
    results, issues, ingredients: ingredientRows,
    summary: {
      ready: built.length, errors: errors.length, warnings: issues.length - errors.length,
      ok: results.filter((r) => r.status === "OK").length,
      failed: results.filter((r) => r.status === "FAILED").length,
      skipped: results.filter((r) => r.status === "SKIPPED").length,
      ingredientsCreated: ingredientRows.filter((r) => r.status === "OK").length,
      ingredientsFailed: Object.keys(ingFailed).length,
      dryRun, blocked,
    },
  };
}
