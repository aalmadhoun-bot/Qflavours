// Orchestrates: connect -> load reference data -> validate -> create categories and apps -> upload -> report.
import { Client, ApiError } from "./api.js";
import { Context, buildPayloads, keynorm, norm, priceColumnNames } from "./builder.js";

export const MODES = {
  upsert: "إنشاء الجديد وتحديث الموجود (بنفس الاسم الإنجليزي)",
  create_only: "إنشاء الجديد فقط وتخطي الموجود",
  always_create: "إنشاء الكل حتى لو كان الاسم موجوداً",
};

export async function connect(token, baseUrl, log) {
  const client = new Client(token, baseUrl, { log });
  let me;
  try { me = await client.me(); }
  catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw new ApiError(`${e.message}\nالمفتاح غير مقبول (جُرّب بطريقتي Bearer و API-TOKEN). تأكد من نسخه كاملاً، ومن أنه مفعّل للاستخدام عبر الـ API.`, e.status);
    }
    throw e;
  }
  log(`✓ متصل: ${client.baseUrl}${client.viaProxy ? " (عبر خادم الموقع — API-TOKEN)" : " (Bearer مباشرة)"}`);
  return { client, me };
}

export async function loadContext(client, me, { marketId, branchId } = {}, log) {
  marketId = marketId || Client.marketIdOf(me);
  branchId = branchId || Client.branchIdOf(me);
  if (!marketId) log("⚠️ لم يتم العثور على market_id — أدخله يدوياً");
  log(`• Market: ${marketId}  • Branch: ${branchId || "-"}`);
  const [categories, { orderTypes, catalog }, ingredients] = await Promise.all([
    client.categories(marketId), loadOrderTypes(client), client.ingredients(marketId),
  ]);
  log(`• التصنيفات: ${categories.length}`);
  log(`• أنواع الطلب/التطبيقات المسجلة: ${orderTypes.map((o) => o.key + (o.name_ar ? ` (${o.name_ar})` : "") + (o.adopted && !o.active ? " — معطّل" : "")).join("، ") || "لا يوجد"}`);
  log(`• المواد الخام المعروفة: ${ingredients.length}`);
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
      if (t && t.adopted && !t.active && !warned.has(key)) { warned.add(key); log(`⚠️ التطبيق ${t.name_ar || t.key} مسجّل لكنه معطّل في حسابك — فعّله من إعدادات فليفرز ليظهر سعره`); }
      continue;
    }
    if (!ctx.createOrderTypes) continue;
    const known = ctx.catalogType(name);
    const planned = known ? known.key : `NEW:${keynorm(name)}`;
    if (!plan.has(planned)) plan.set(planned, { key: planned, name, known, label: known ? known.name_ar || known.name_en || known.key : name });
  }
  ctx.pendingOrderTypes = [...plan.values()].map((t) => ({ key: t.key, name_en: t.name, name_ar: t.known?.name_ar ?? null, name: t.known?.name_en ?? null }));
  ctx.reindex();
  return [...plan.values()];
}

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
      log(t.known ? `🆕 تم تفعيل التطبيق ${t.label} (${t.key}) في حسابك` : `🆕 تم إنشاء نوع الطلب: ${t.name}`);
    } catch (e) {
      realKey[t.key] = null;
      log(`❌ فشل ${t.known ? "تفعيل التطبيق" : "إنشاء نوع الطلب"} ${t.label}: ${e.message} — لن تُرفع أسعاره`);
    }
  }
  try {
    ctx.orderTypes = await client.orderTypes();
    for (const t of plan) {
      if (t.known || realKey[t.key] === null || realKey[t.key]) continue;
      const k = keynorm(t.name);
      realKey[t.key] = ctx.orderTypes.find((o) => [o.name_en, o.name_ar].some((v) => v && keynorm(v) === k))?.key || null;
      if (!realKey[t.key]) log(`❌ أُنشئ نوع الطلب ${t.name} لكن تعذّر معرفة مفتاحه — لن تُرفع أسعاره`);
    }
  } catch (e) { log(`⚠️ تعذّر تحديث قائمة أنواع الطلب: ${e.message}`); }
  for (const b of built) {
    for (const o of b.body.options || []) {
      if (!o.prices?.length) continue;
      o.prices = o.prices
        .filter((p) => !(p.priceable_id in realKey) || realKey[p.priceable_id])
        .map((p) => (p.priceable_id in realKey ? { ...p, priceable_id: realKey[p.priceable_id] } : p));
    }
  }
}

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
  log(`• منتجات جاهزة: ${built.length} | أخطاء: ${errors.length} | تحذيرات: ${issues.length - errors.length}`);

  const blocked = errors.length > 0 && !dryRun && !allowPartial;
  if (blocked) log("⛔ يوجد أخطاء في الملف — لم يتم رفع أي منتج. صحّح الأخطاء أو فعّل خيار رفع المنتجات السليمة فقط.");

  // create missing categories (live only) and plug their ids into the payloads
  const catFailed = {};
  const isNew = (v) => v && typeof v === "object" && "__new_category__" in v;
  const used = [...new Set(built.filter((b) => isNew(b.body.category_id)).map((b) => b.body.category_id.__new_category__))];
  if (used.length && !blocked) {
    if (dryRun) used.forEach((k) => log(`🆕 سيتم إنشاء التصنيف: ${ctx.pendingCategories[k].name_en} / ${ctx.pendingCategories[k].name_ar}`));
    else {
      const created = {};
      for (const k of used) {
        const c = ctx.pendingCategories[k];
        try {
          const d = await client.createCategory(c.name_en, c.name_ar, ctx.marketId);
          created[k] = d.id;
          ctx.categories.push(d);
          log(d._existing ? `✓ التصنيف موجود مسبقاً: ${c.name_en} (ID ${d.id}) — تم الربط به` : `🆕 تم إنشاء التصنيف: ${c.name_en} (ID ${d.id})`);
        } catch (e) { catFailed[k] = e.message; log(`❌ فشل إنشاء التصنيف ${c.name_en}: ${e.message}`); }
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
    if (dryRun) typePlan.forEach((t) => log(t.known ? `🆕 سيتم تفعيل التطبيق ${t.label} (${t.key}) في حسابك` : `🆕 سيتم إنشاء نوع طلب جديد في حسابك: ${t.name}`));
    else await createOrderTypes(client, ctx, typePlan, built, log);
  }
  ctx.pendingOrderTypes = [];
  ctx.reindex();

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
    if (blocked) res.status = "BLOCKED";
    else if (!dryRun && isNew(pc)) { res.status = "FAILED"; res.message = "فشل إنشاء التصنيف: " + (catFailed[pc.__new_category__] || ""); }
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
    results, issues,
    summary: {
      ready: built.length, errors: errors.length, warnings: issues.length - errors.length,
      ok: results.filter((r) => r.status === "OK").length,
      failed: results.filter((r) => r.status === "FAILED").length,
      skipped: results.filter((r) => r.status === "SKIPPED").length,
      dryRun, blocked,
    },
  };
}
