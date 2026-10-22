// Orchestrates: connect -> load reference data -> validate -> create categories -> upload -> report.
import { Client, ApiError } from "./api.js";
import { Context, buildPayloads, norm } from "./builder.js";

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
  const [categories, orderTypes, ingredients] = await Promise.all([
    client.categories(marketId), client.orderTypes(), client.ingredients(marketId),
  ]);
  log(`• التصنيفات: ${categories.length}`);
  log(`• أنواع الطلب/التطبيقات: ${orderTypes.map((o) => o.key + (o.name_ar ? ` (${o.name_ar})` : "")).join("، ") || "لم تُجلب"}`);
  log(`• المواد الخام المعروفة: ${ingredients.length}`);
  return new Context({ marketId, defaultBranchId: branchId, categories, ingredients, orderTypes });
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
