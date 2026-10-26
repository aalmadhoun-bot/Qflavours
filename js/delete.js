// Delete page (admins): connect with the Flavours API key, pick what to work on (products, ingredients or
// recipes from Inventory), list it, back it up to Excel, then act on the selected items or all of them,
// one by one, stoppable, with a report. Products also offer "clear the recipe": unlink every ingredient
// from the product's options and keep the product (Client.clearProductRecipe).
import { Client } from "./api.js";
import { saveXlsx, stamp, writeWorkbook } from "./excel.js";
import { L } from "./i18n.js";
import { askConfirm, mountNav, track } from "./nav.js";
import { connect } from "./uploader.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pick = (o, ar, en) => L(o?.[ar], o?.[en]) || o?.[en] || o?.[ar];
const recipeLinks = (p) => {
  const opts = p.options || p.modifiers;
  if (!Array.isArray(opts) || !opts.some((o) => Array.isArray(o.ingredients))) return null;  // not loaded
  return opts.reduce((n, o) => n + (o.ingredients?.length || 0), 0);
};
const unitOf = (i) => {
  const u = i.recipe_unit ?? i.target_unit ?? i.unit ?? i.storage_unit;
  return u && typeof u === "object" ? pick(u, "name_ar", "name_en") || u.key : u;
};

// What each tab lists and how it deletes. cols: [header ar, header en, cell(item)].
const KINDS = {
  products: {
    name: () => L("المنتجات", "Products"), one: () => L("منتج", "products"),
    load: async (c, m) => {
      for (const inc of [["options", "options.ingredients"], ["options"]]) { try { return await c.products(m, inc); } catch { /* next */ } }
      return c.products(m);
    },
    remove: (c, id) => c.deleteProduct(id),
    cols: () => [
      [L("الاسم بالعربي", "Arabic name"), (p) => esc(p.name_ar)],
      [L("الاسم بالإنجليزي", "English name"), (p) => `<bdi dir="ltr">${esc(p.name_en)}</bdi>`],
      [L("التصنيف", "Category"), (p) => esc(pick(p.category, "name_ar", "name_en") || p.category_id || p.product_category_id || "—")],
      [L("ربط بمواد خام", "Ingredient links"), (p) => { const n = recipeLinks(p); return n === null ? "—" : n ? `<b>${n}</b>` : `<span class="hint">0</span>`; }],
    ],
    backup: (p) => ({ category: pick(p.category, "name_ar", "name_en") || p.category_id, recipe_links: recipeLinks(p),
      options: (p.options || p.modifiers || []).map((o) => `${o.name_ar || o.name_en} = ${o.price}`).join(" | ") || null }),
  },
  ingredients: {
    name: () => L("المواد الخام", "Ingredients"), one: () => L("مادة خام", "ingredients"),
    load: (c, m) => c.inventoryIngredients(m),
    remove: (c, id) => c.deleteIngredient(id),
    cols: () => [
      [L("الاسم بالعربي", "Arabic name"), (i) => esc(i.name_ar)],
      [L("الاسم بالإنجليزي", "English name"), (i) => `<bdi dir="ltr">${esc(i.name_en ?? i.name)}</bdi>`],
      [L("الوحدة", "Unit"), (i) => esc(unitOf(i) ?? "—")],
    ],
    backup: (i) => ({ unit: unitOf(i), cost: i.cost, quantity: i.quantity ?? i.stock }),
  },
  recipes: {
    name: () => L("الوصفات", "Recipes"), one: () => L("وصفة", "recipes"),
    load: (c, m) => c.inventoryRecipes(m),
    remove: (c, id) => c.deleteRecipe(id),
    cols: () => [
      [L("الاسم بالعربي", "Arabic name"), (r) => esc(r.name_ar)],
      [L("الاسم بالإنجليزي", "English name"), (r) => `<bdi dir="ltr">${esc(r.name_en ?? r.name)}</bdi>`],
      [L("الوحدة", "Unit"), (r) => esc(unitOf(r) ?? "—")],
      [L("المكونات", "Ingredients"), (r) => esc(r.ingredients_count ?? r.ingredients?.length ?? "—")],
    ],
    backup: (r) => ({ unit: unitOf(r), ingredients: (r.ingredients || []).map((i) => `${pick(i.ingredient, "name_ar", "name_en") ?? i.ingredient_id} × ${i.qty}`).join(" | ") || null }),
  },
};

// The word to type before acting; either language's word is accepted.
const CONFIRM = {
  delete: { selected: ["احذف", "DELETE"], all: ["احذف الكل", "DELETE ALL"] },
  clear: { selected: ["امسح", "CLEAR"], all: ["امسح الكل", "CLEAR ALL"] },
};
// conn / outcome are kept so they re-render in the other language
const state = { client: null, marketId: null, kind: "products", items: [], selected: new Set(), busy: false, stop: false,
  report: null, conn: "idle", connError: "", outcome: null };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } } };
const K = () => KINDS[state.kind];
const mode = () => document.querySelector("input[name=mode]:checked").value;
const action = () => (state.kind === "products" ? document.querySelector("input[name=action]:checked").value : "delete");
const confirmWord = () => L(...CONFIRM[action()][mode()]);
const confirmed = () => CONFIRM[action()][mode()].includes($("confirmText").value.trim());
const itemName = (x) => pick(x, "name_ar", "name_en") || x.name;

function log(msg) {
  const el = $("log");
  el.textContent = (el.textContent === "—" ? "" : el.textContent + "\n") + msg;
  el.scrollTop = el.scrollHeight;
}
function setStatus(el, text, cls = "") { el.textContent = text; el.className = "status" + (cls ? " " + cls : ""); }

function targets() {
  return mode() === "all" ? state.items : state.items.filter((x) => state.selected.has(String(x.id)));
}

// Labels that depend on the tab and the action (re-drawn on every change and on language change).
function renderLabels() {
  const k = K(), clear = action() === "clear";
  document.querySelectorAll("#tabs [data-kind]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.kind === state.kind)));
  $("listTitle").textContent = k.name();
  $("actionRow").classList.toggle("hidden", state.kind !== "products");
  $("actDeleteLbl").textContent = L("حذف المنتجات", "Delete the products");
  $("actClearLbl").textContent = L("مسح الوصفة فقط (فك ربط المواد الخام وإبقاء المنتج)", "Clear the recipe only (unlink the ingredients, keep the product)");
  $("clearHint").classList.toggle("hidden", !clear);
  $("clearHint").textContent = L("يحمّل المنتج كما يفعل موقع فليفرز ثم يعيد إرساله بنفس الأسعار والخيارات وبدون مواد خام. جرّبه أولاً على منتج واحد وتأكد منه في فليفرز.",
    "Loads the product the way the Flavours site does, then sends it back with the same prices and options and no ingredients. Try it on one product first and check it in Flavours.");
  $("actTitle").textContent = clear ? L("مسح الوصفة", "Clear recipes") : L("الحذف", "Delete");
  $("modeSelLbl").textContent = clear ? L("المنتجات المحددة فقط", "The selected products only") : L(`حذف ${k.name()} المحددة فقط`, `Delete the selected ${k.one()} only`);
  $("modeAllLbl").textContent = clear ? L("كل المنتجات", "All products") : L(`حذف كل ${k.name()}`, `Delete all ${k.one()}`);
  $("mDoneLbl").textContent = clear ? L("مُسحت وصفته", "Cleared") : L("حُذف", "Deleted");
  $("listHead").innerHTML = `<th style="width:36px"><input type="checkbox" id="checkAll" title="${L("تحديد الكل (المعروض)", "Select all (shown)")}"></th><th>ID</th>`
    + k.cols().map(([h]) => `<th>${h}</th>`).join("");
  $("checkAll").onchange = onCheckAll;
}

function refresh() {
  const n = targets().length, clear = action() === "clear";
  $("selCount").textContent = state.selected.size;
  $("allCount").textContent = state.items.length;
  $("selInfo").textContent = L(`المحدد: ${state.selected.size} من ${state.items.length}`, `Selected: ${state.selected.size} of ${state.items.length}`);
  $("confirmLabel").textContent = L(`للتأكيد اكتب: ${confirmWord()}`, `To confirm, type: ${confirmWord()}`);
  $("btnDelete").textContent = clear ? L(`🧹 مسح وصفة ${n} منتج`, `🧹 Clear the recipe of ${n} products`)
    : L(`🗑️ حذف ${n} ${K().one()}`, `🗑️ Delete ${n} ${K().one()}`);
  $("btnDelete").className = clear ? "go" : "danger-solid";
  $("btnDelete").disabled = state.busy || !n || !confirmed();
  for (const id of ["btnConnect", "btnBackup", "btnReload"]) $(id).disabled = state.busy;
  document.querySelectorAll("input[name=mode], input[name=action], #tabs button").forEach((r) => { r.disabled = state.busy; });
  $("btnStop").classList.toggle("hidden", !state.busy);
}

function renderConn() {
  const el = $("connStatus");
  if (state.conn === "connecting") return setStatus(el, L("⏳ جارٍ الاتصال…", "⏳ Connecting…"));
  if (state.conn === "error") return setStatus(el, "❌ " + state.connError, "bad");
  if (state.conn === "ok") return setStatus(el, L(`✅ متصل — Market: ${state.marketId || "-"}`, `✅ Connected — Market: ${state.marketId || "-"}`), "ok");
  setStatus(el, L("غير متصل", "Not connected"));
}

function renderOutcome() {
  const o = state.outcome;
  if (!o) return;
  const did = o.action === "clear" ? L("مُسحت وصفة", "Cleared the recipe of") : L("حُذف", "Deleted");
  const text = L(`${o.stopped ? "⏹️ أُوقف التنفيذ. " : ""}${did} ${o.done} من ${o.total}${o.failed ? ` — فشل ${o.failed} (التفاصيل في التقرير)` : ""}.`,
    `${o.stopped ? "⏹️ Stopped. " : ""}${did} ${o.done} of ${o.total}${o.failed ? ` — ${o.failed} failed (details in the report)` : ""}.`);
  setStatus($("resMsg"), text, o.failed ? "bad" : "ok");
}

function visible() {
  const q = $("search").value.trim().toLowerCase();
  if (!q) return state.items;
  return state.items.filter((x) => [x.id, x.name_ar, x.name_en, x.name].some((v) => String(v ?? "").toLowerCase().includes(q)));
}

function renderRows() {
  const list = visible(), cols = K().cols();
  $("count").textContent = state.items.length;
  $("rows").innerHTML = list.map((x) => `<tr>
    <td><input type="checkbox" data-id="${esc(x.id)}" ${state.selected.has(String(x.id)) ? "checked" : ""}></td>
    <td><span class="pill">${esc(x.id)}</span></td>${cols.map(([, cell]) => `<td>${cell(x)}</td>`).join("")}</tr>`).join("")
    || `<tr><td colspan="${cols.length + 2}" class="hint">${$("search").value ? L("لا توجد نتائج مطابقة للبحث", "Nothing matches the search") : L("القائمة فارغة", "The list is empty")}</td></tr>`;
  $("checkAll").checked = list.length > 0 && list.every((x) => state.selected.has(String(x.id)));
  refresh();
}

async function loadItems() {
  const k = K();
  log(L(`📦 جارٍ جلب ${k.name()}…`, `📦 Loading ${k.name().toLowerCase()}…`));
  const items = await k.load(state.client, state.marketId);
  state.items = (items || []).filter((x) => x && x.id !== undefined);
  const ids = new Set(state.items.map((x) => String(x.id)));
  state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
  log(L(`✓ ${k.name()}: ${state.items.length}`, `✓ ${k.name()}: ${state.items.length}`));
  $("listCard").classList.remove("hidden");
  $("deleteCard").classList.remove("hidden");
  renderLabels();
  renderRows();
}

async function busy(fn) {
  state.busy = true; refresh();
  try { return await fn(); } finally { state.busy = false; refresh(); }
}

function onCheckAll(e) {
  for (const x of visible()) { if (e.target.checked) state.selected.add(String(x.id)); else state.selected.delete(String(x.id)); }
  renderRows();
}

$("btnConnect").onclick = () => busy(async () => {
  const token = $("token").value.trim();
  if (!token) return alert(L("أدخل مفتاح الـ API", "Enter the API key"));
  $("log").textContent = "";
  state.conn = "connecting"; renderConn();
  try {
    const { client, me } = await connect(token, null, log);
    state.client = client;
    state.marketId = $("market").value.trim() || Client.marketIdOf(me);
    if (!state.marketId) log(L("⚠️ لم يتم العثور على market_id — أدخله يدوياً من الإعدادات المتقدمة", "⚠️ market_id not found — enter it in the advanced settings"));
    await loadItems();
    state.conn = "ok";
    track("connect", { market: state.marketId, page: "delete" });
  } catch (e) {
    Object.assign(state, { client: null, conn: "error", connError: e.message });
    log("❌ " + e.message);
  }
  renderConn();
});

$("tabs").onclick = (e) => {
  const b = e.target.closest("[data-kind]");
  if (!b || state.busy || b.dataset.kind === state.kind) return;
  Object.assign(state, { kind: b.dataset.kind, items: [], selected: new Set(), outcome: null, report: null });
  $("search").value = ""; $("confirmText").value = "";
  document.querySelector('input[name=action][value="delete"]').checked = true;
  $("result").classList.add("hidden");
  renderLabels(); renderRows();
  if (state.client) busy(() => loadItems().catch((err) => log("❌ " + err.message)));
};

$("btnReload").onclick = () => busy(() => loadItems().catch((e) => log("❌ " + e.message)));

$("btnBackup").onclick = () => busy(async () => {
  const k = K();
  const rows = state.items.map((x) => ({ id: x.id, name_ar: x.name_ar, name_en: x.name_en ?? x.name, ...k.backup(x), json: JSON.stringify(x) }));
  saveXlsx(await writeWorkbook({ [state.kind]: rows }), `flavours_${state.kind}_backup_${stamp()}.xlsx`);
  log(L(`💾 تم تحميل نسخة احتياطية لـ ${rows.length} من ${k.name()}`, `💾 Backup downloaded: ${rows.length} ${k.one()}`));
  track("backup", { market: state.marketId, kind: state.kind, products: rows.length });
});

$("search").oninput = renderRows;
$("rows").onchange = (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
  renderRows();
};
document.querySelectorAll("input[name=mode], input[name=action]").forEach((r) => {
  r.onchange = () => { $("confirmText").value = ""; renderLabels(); renderRows(); };
});
$("confirmText").oninput = refresh;
$("btnStop").onclick = () => {
  state.stop = true; $("btnStop").disabled = true;
  log(L("⏹️ سيتوقف التنفيذ بعد العنصر الحالي…", "⏹️ Will stop after the current item…"));
};

$("btnDelete").onclick = async () => {
  const list = targets(), k = K(), act = action(), clear = act === "clear";
  if (!list.length || !confirmed()) return;
  const what = mode() === "all" ? L(`كل ${k.name()} (${list.length})`, `all ${k.one()} (${list.length})`) : L(`${list.length} من ${k.name()} المحددة`, `${list.length} selected ${k.one()}`);
  const question = clear
    ? L(`سيتم مسح وصفة ${what}: فك ربط كل المواد الخام من خياراتها مع إبقاء المنتجات.\n\nمتابعة؟`, `This will clear the recipe of ${what}: unlink every ingredient from their options and keep the products.\n\nContinue?`)
    : L(`سيتم حذف ${what} نهائياً من فليفرز.\nلا يمكن التراجع عن هذه العملية.\n\nمتابعة؟`, `This will permanently delete ${what} from Flavours.\nThis can't be undone.\n\nContinue?`);
  const go = await askConfirm(question, { ok: clear ? L(`🧹 نعم، امسح ${list.length}`, `🧹 Yes, clear ${list.length}`) : L(`🗑️ نعم، احذف ${list.length}`, `🗑️ Yes, delete ${list.length}`), danger: !clear });
  if (!go) return log(L("• أُلغيت العملية", "• Cancelled"));
  busy(async () => {
    state.stop = false; $("btnStop").disabled = false;
    $("prog").classList.remove("hidden"); $("prog").value = 0;
    $("result").classList.remove("hidden");
    const report = [];
    let done = 0, failed = 0;
    const show = () => { $("mDone").textContent = done; $("mFail").textContent = failed; $("mLeft").textContent = list.length - report.length; };
    log(clear ? L(`🧹 بدء مسح وصفة ${list.length} منتج…`, `🧹 Clearing the recipe of ${list.length} products…`) : L(`🗑️ بدء حذف ${list.length} من ${k.name()}…`, `🗑️ Deleting ${list.length} ${k.one()}…`));
    for (const x of list) {
      if (state.stop) break;
      const row = { kind: state.kind, action: act, id: x.id, name_ar: x.name_ar, name_en: x.name_en ?? x.name, result: "", error: null };
      try {
        if (clear) {
          const { before } = await state.client.clearProductRecipe(x.id, state.marketId);
          // what was unlinked, per option, so it can be put back by hand if needed
          row.ingredients_before = (before.options || []).filter((o) => o.ingredients?.length)
            .map((o) => `${o.name_en || o.name_ar}: ${o.ingredients.map((i) => `${pick(i.ingredient, "name_ar", "name_en") ?? i.ingredient_id} × ${i.qty}`).join(", ")}`).join(" | ") || null;
          row.result = L("مُسحت", "Cleared"); done++;
          log(L(`✓ مُسحت وصفة: ${itemName(x)} (ID ${x.id})`, `✓ Recipe cleared: ${itemName(x)} (ID ${x.id})`));
        } else {
          await k.remove(state.client, x.id);
          row.result = L("حُذف", "Deleted"); done++;
          log(L(`✓ حُذف: ${itemName(x)} (ID ${x.id})`, `✓ Deleted: ${itemName(x)} (ID ${x.id})`));
        }
      } catch (e) {
        if (!clear && e.status === 404) {
          row.result = L("غير موجود", "Not found"); done++;
          log(L(`• غير موجود (ربما حُذف مسبقاً): ID ${x.id}`, `• Not found (maybe already deleted): ID ${x.id}`));
        } else {
          row.result = L("فشل", "Failed"); row.error = e.message; failed++;
          log(L(`❌ فشل ${clear ? "مسح وصفة" : "حذف"} ${itemName(x)} (ID ${x.id}): ${e.message}`, `❌ Could not ${clear ? "clear the recipe of" : "delete"} ${itemName(x)} (ID ${x.id}): ${e.message}`));
        }
      }
      report.push(row);
      $("prog").value = report.length / list.length;
      show();
    }
    const stopped = report.length < list.length;
    for (const x of list.slice(report.length)) report.push({ kind: state.kind, action: act, id: x.id, name_ar: x.name_ar, name_en: x.name_en ?? x.name, result: L("لم يُنفَّذ (أُوقف)", "Not done (stopped)"), error: null });
    show();
    state.report = report;
    state.outcome = { action: act, done, failed, total: list.length, stopped };
    renderOutcome();
    if (clear) track("clear_recipe", { market: state.marketId, total: list.length, cleared: done, failed });
    else track("delete", { market: state.marketId, kind: state.kind, total: list.length, deleted: done, failed });
    log(L(`🏁 انتهى: نجح ${done}، فشل ${failed}${stopped ? "، وأُوقف قبل الباقي" : ""}`, `🏁 Done: ${done} succeeded, ${failed} failed${stopped ? ", stopped before the rest" : ""}`));
    $("prog").classList.add("hidden");
    $("confirmText").value = "";
    state.selected.clear();
    await loadItems().catch((e) => log(L("❌ تعذّر تحديث القائمة: ", "❌ Could not refresh the list: ") + e.message));
  });
};

$("btnReport").onclick = async () => {
  if (!state.report) return;
  saveXlsx(await writeWorkbook({ Report: state.report }), `flavours_${state.kind}_${state.outcome?.action ?? "delete"}_report_${stamp()}.xlsx`);
  track("delete_report", { market: state.marketId, kind: state.kind });
};

addEventListener("langchange", () => { renderConn(); renderOutcome(); renderLabels(); renderRows(); });

(async () => {
  renderConn();
  renderLabels();
  const me = await mountNav("delete");
  if (me.role !== "admin") return $("denied").classList.remove("hidden");
  $("page").classList.remove("hidden");
  const saved = store.get("flv_token");
  if (saved) $("token").value = saved;
  refresh();
})().catch((e) => alert(e.message));
