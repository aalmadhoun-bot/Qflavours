// Delete products page (admins): connect with the Flavours API key, list the market's products,
// back them up to Excel, then delete the selected ones or all of them (one by one, stoppable, with a report).
import { Client } from "./api.js";
import { saveXlsx, stamp, writeWorkbook } from "./excel.js";
import { L } from "./i18n.js";
import { askConfirm, mountNav, track } from "./nav.js";
import { connect } from "./uploader.js";

const $ = (id) => document.getElementById(id);
// The word to type before deleting; either language's word is accepted.
const CONFIRM = { selected: ["احذف", "DELETE"], all: ["احذف الكل", "DELETE ALL"] };
// conn / outcome are kept so they re-render in the other language
const state = { client: null, marketId: null, products: [], selected: new Set(), busy: false, stop: false, report: null,
  conn: "idle", connError: "", outcome: null };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mode = () => document.querySelector("input[name=mode]:checked").value;
const confirmWord = () => L(...CONFIRM[mode()]);
const confirmed = () => CONFIRM[mode()].includes($("confirmText").value.trim());
const catName = (p) => L(p.category?.name_ar, p.category?.name_en) || p.category?.name_en || p.category?.name_ar
  || p.product_category?.name_ar || p.category_id || p.product_category_id || "—";
const productName = (p) => L(p.name_ar, p.name_en) || p.name_en || p.name_ar;

function log(msg) {
  const el = $("log");
  el.textContent = (el.textContent === "—" ? "" : el.textContent + "\n") + msg;
  el.scrollTop = el.scrollHeight;
}
function setStatus(el, text, cls = "") { el.textContent = text; el.className = "status" + (cls ? " " + cls : ""); }

function targets() {
  return mode() === "all" ? state.products : state.products.filter((p) => state.selected.has(String(p.id)));
}

function refresh() {
  const n = targets().length;
  $("selCount").textContent = state.selected.size;
  $("allCount").textContent = state.products.length;
  $("selInfo").textContent = L(`المحدد: ${state.selected.size} من ${state.products.length}`, `Selected: ${state.selected.size} of ${state.products.length}`);
  $("confirmLabel").textContent = L(`للتأكيد اكتب: ${confirmWord()}`, `To confirm, type: ${confirmWord()}`);
  $("btnDelete").textContent = L(`🗑️ حذف ${n} منتج`, `🗑️ Delete ${n} products`);
  $("btnDelete").disabled = state.busy || !n || !confirmed();
  for (const id of ["btnConnect", "btnBackup", "btnReload"]) $(id).disabled = state.busy;
  document.querySelectorAll("input[name=mode]").forEach((r) => { r.disabled = state.busy; });
  $("btnStop").classList.toggle("hidden", !state.busy);
}

function renderConn() {
  const el = $("connStatus");
  if (state.conn === "connecting") return setStatus(el, L("⏳ جارٍ الاتصال…", "⏳ Connecting…"));
  if (state.conn === "error") return setStatus(el, "❌ " + state.connError, "bad");
  if (state.conn === "ok") {
    return setStatus(el, L(`✅ متصل — Market: ${state.marketId || "-"} — المنتجات: ${state.products.length}`,
      `✅ Connected — Market: ${state.marketId || "-"} — products: ${state.products.length}`), "ok");
  }
  setStatus(el, L("غير متصل", "Not connected"));
}

function renderOutcome() {
  const o = state.outcome;
  if (!o) return;
  const text = L(`${o.stopped ? "⏹️ أُوقف الحذف. " : ""}حُذف ${o.done} من ${o.total}${o.failed ? ` — فشل ${o.failed} (التفاصيل في التقرير)` : ""}.`,
    `${o.stopped ? "⏹️ Deletion stopped. " : ""}Deleted ${o.done} of ${o.total}${o.failed ? ` — ${o.failed} failed (details in the report)` : ""}.`);
  setStatus($("resMsg"), text, o.failed ? "bad" : "ok");
}

function visible() {
  const q = $("search").value.trim().toLowerCase();
  if (!q) return state.products;
  return state.products.filter((p) => [p.id, p.name_ar, p.name_en].some((v) => String(v ?? "").toLowerCase().includes(q)));
}

function renderRows() {
  const list = visible();
  $("count").textContent = state.products.length;
  $("rows").innerHTML = list.map((p) => `<tr>
    <td><input type="checkbox" data-id="${esc(p.id)}" ${state.selected.has(String(p.id)) ? "checked" : ""}></td>
    <td><span class="pill">${esc(p.id)}</span></td>
    <td>${esc(p.name_ar)}</td><td><bdi dir="ltr">${esc(p.name_en)}</bdi></td>
    <td>${esc(catName(p))}</td></tr>`).join("")
    || `<tr><td colspan="5" class="hint">${$("search").value ? L("لا توجد منتجات مطابقة للبحث", "No products match the search") : L("لا توجد منتجات", "No products")}</td></tr>`;
  $("checkAll").checked = list.length > 0 && list.every((p) => state.selected.has(String(p.id)));
  refresh();
}

async function loadProducts() {
  log(L("📦 جارٍ جلب المنتجات…", "📦 Loading products…"));
  let items;
  try { items = await state.client.products(state.marketId, ["options"]); }
  catch { items = await state.client.products(state.marketId); }
  state.products = items.filter((p) => p && p.id !== undefined);
  const ids = new Set(state.products.map((p) => String(p.id)));
  state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
  log(L(`✓ عدد المنتجات: ${state.products.length}`, `✓ Products: ${state.products.length}`));
  $("listCard").classList.remove("hidden");
  $("deleteCard").classList.remove("hidden");
  renderRows();
}

async function busy(fn) {
  state.busy = true; refresh();
  try { return await fn(); } finally { state.busy = false; refresh(); }
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
    await loadProducts();
    state.conn = "ok";
    track("connect", { market: state.marketId, page: "delete" });
  } catch (e) {
    Object.assign(state, { client: null, conn: "error", connError: e.message });
    log("❌ " + e.message);
  }
  renderConn();
});

$("btnReload").onclick = () => busy(() => loadProducts().then(renderConn).catch((e) => log("❌ " + e.message)));

$("btnBackup").onclick = () => busy(async () => {
  const rows = state.products.map((p) => ({
    id: p.id, name_ar: p.name_ar, name_en: p.name_en, category: catName(p),
    description_ar: p.description_ar, description_en: p.description_en, branch_id: p.branch_id, is_active: p.is_active,
    options: (p.options || p.modifiers || []).map((o) => `${o.name_ar || o.name_en} = ${o.price}`).join(" | ") || null,
    json: JSON.stringify(p),
  }));
  saveXlsx(await writeWorkbook({ Products: rows }), `flavours_products_backup_${stamp()}.xlsx`);
  log(L(`💾 تم تحميل نسخة احتياطية لـ ${rows.length} منتج`, `💾 Backup downloaded for ${rows.length} products`));
  track("backup", { market: state.marketId, products: rows.length });
});

$("search").oninput = renderRows;
$("rows").onchange = (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
  renderRows();
};
$("checkAll").onchange = (e) => {
  for (const p of visible()) { if (e.target.checked) state.selected.add(String(p.id)); else state.selected.delete(String(p.id)); }
  renderRows();
};
document.querySelectorAll("input[name=mode]").forEach((r) => { r.onchange = () => { $("confirmText").value = ""; refresh(); }; });
$("confirmText").oninput = refresh;
$("btnStop").onclick = () => {
  state.stop = true; $("btnStop").disabled = true;
  log(L("⏹️ سيتوقف الحذف بعد المنتج الحالي…", "⏹️ Deletion will stop after the current product…"));
};

$("btnDelete").onclick = async () => {
  const list = targets();
  if (!list.length || !confirmed()) return;
  const what = mode() === "all" ? L(`كل المنتجات (${list.length})`, `all products (${list.length})`) : L(`${list.length} منتج محدد`, `${list.length} selected products`);
  const go = await askConfirm(L(`سيتم حذف ${what} نهائياً من فليفرز.\nلا يمكن التراجع عن هذه العملية.\n\nمتابعة؟`,
    `This will permanently delete ${what} from Flavours.\nThis can't be undone.\n\nContinue?`),
    { ok: L(`🗑️ نعم، احذف ${list.length}`, `🗑️ Yes, delete ${list.length}`), danger: true });
  if (!go) return log(L("• أُلغي الحذف", "• Deletion cancelled"));
  busy(async () => {
    state.stop = false; $("btnStop").disabled = false;
    $("prog").classList.remove("hidden"); $("prog").value = 0;
    $("result").classList.remove("hidden");
    const report = [];
    let done = 0, failed = 0;
    const show = () => { $("mDone").textContent = done; $("mFail").textContent = failed; $("mLeft").textContent = list.length - report.length; };
    log(L(`🗑️ بدء حذف ${list.length} منتج…`, `🗑️ Deleting ${list.length} products…`));
    for (const p of list) {
      if (state.stop) break;
      const row = { id: p.id, name_ar: p.name_ar, name_en: p.name_en, result: "", error: null };
      try {
        await state.client.deleteProduct(p.id);
        row.result = L("حُذف", "Deleted"); done++;
        log(L(`✓ حُذف: ${productName(p)} (ID ${p.id})`, `✓ Deleted: ${productName(p)} (ID ${p.id})`));
      } catch (e) {
        if (e.status === 404) {
          row.result = L("غير موجود", "Not found"); done++;
          log(L(`• غير موجود (ربما حُذف مسبقاً): ID ${p.id}`, `• Not found (maybe already deleted): ID ${p.id}`));
        } else {
          row.result = L("فشل", "Failed"); row.error = e.message; failed++;
          log(L(`❌ فشل حذف ${productName(p)} (ID ${p.id}): ${e.message}`, `❌ Could not delete ${productName(p)} (ID ${p.id}): ${e.message}`));
        }
      }
      report.push(row);
      $("prog").value = report.length / list.length;
      show();
    }
    const stopped = report.length < list.length;
    for (const p of list.slice(report.length)) report.push({ id: p.id, name_ar: p.name_ar, name_en: p.name_en, result: L("لم يُنفَّذ (أُوقف)", "Not done (stopped)"), error: null });
    show();
    state.report = report;
    state.outcome = { done, failed, total: list.length, stopped };
    track("delete", { market: state.marketId, total: list.length, deleted: done, failed });
    renderOutcome();
    log(L(`🏁 انتهى: حُذف ${done}، فشل ${failed}${stopped ? "، وأُوقف قبل الباقي" : ""}`, `🏁 Done: ${done} deleted, ${failed} failed${stopped ? ", stopped before the rest" : ""}`));
    $("prog").classList.add("hidden");
    $("confirmText").value = "";
    state.selected.clear();
    await loadProducts().then(renderConn).catch((e) => log(L("❌ تعذّر تحديث القائمة: ", "❌ Could not refresh the list: ") + e.message));
  });
};

$("btnReport").onclick = async () => {
  if (!state.report) return;
  saveXlsx(await writeWorkbook({ Deleted: state.report }), `flavours_delete_report_${stamp()}.xlsx`);
  track("delete_report", { market: state.marketId });
};

addEventListener("langchange", () => { renderConn(); renderOutcome(); if (state.products.length) renderRows(); else refresh(); });

(async () => {
  renderConn();
  const me = await mountNav("delete");
  if (me.role !== "admin") return $("denied").classList.remove("hidden");
  $("page").classList.remove("hidden");
  const saved = store.get("flv_token");
  if (saved) $("token").value = saved;
  refresh();
})().catch((e) => alert(e.message));
