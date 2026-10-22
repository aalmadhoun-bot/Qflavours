// Delete products page (admins): connect with the Flavours API key, list the market's products,
// back them up to Excel, then delete the selected ones or all of them (one by one, stoppable, with a report).
import { Client } from "./api.js";
import { saveXlsx, stamp, writeWorkbook } from "./excel.js";
import { askConfirm, mountNav } from "./nav.js";
import { connect } from "./uploader.js";

const $ = (id) => document.getElementById(id);
const CONFIRM = { selected: "احذف", all: "احذف الكل" };
const state = { client: null, marketId: null, products: [], selected: new Set(), busy: false, stop: false, report: null };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mode = () => document.querySelector("input[name=mode]:checked").value;
const catName = (p) => p.category?.name_ar || p.category?.name_en || p.product_category?.name_ar || p.category_id || p.product_category_id || "—";

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
  $("selInfo").textContent = `المحدد: ${state.selected.size} من ${state.products.length}`;
  $("confirmLabel").textContent = `للتأكيد اكتب: ${CONFIRM[mode()]}`;
  $("btnDelete").textContent = `🗑️ حذف ${n} منتج`;
  $("btnDelete").disabled = state.busy || !n || $("confirmText").value.trim() !== CONFIRM[mode()];
  for (const id of ["btnConnect", "btnBackup", "btnReload"]) $(id).disabled = state.busy;
  document.querySelectorAll("input[name=mode]").forEach((r) => { r.disabled = state.busy; });
  $("btnStop").classList.toggle("hidden", !state.busy);
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
    <td>${esc(p.name_ar)}</td><td style="direction:ltr;text-align:right">${esc(p.name_en)}</td>
    <td>${esc(catName(p))}</td></tr>`).join("") || `<tr><td colspan="5" class="hint">لا توجد منتجات${$("search").value ? " مطابقة للبحث" : ""}</td></tr>`;
  $("checkAll").checked = list.length > 0 && list.every((p) => state.selected.has(String(p.id)));
  refresh();
}

async function loadProducts() {
  log("📦 جارٍ جلب المنتجات…");
  let items;
  try { items = await state.client.products(state.marketId, ["options"]); }
  catch { items = await state.client.products(state.marketId); }
  state.products = items.filter((p) => p && p.id !== undefined);
  const ids = new Set(state.products.map((p) => String(p.id)));
  state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
  log(`✓ عدد المنتجات: ${state.products.length}`);
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
  if (!token) return alert("أدخل مفتاح الـ API");
  $("log").textContent = "";
  setStatus($("connStatus"), "⏳ جارٍ الاتصال…");
  try {
    const { client, me } = await connect(token, null, log);
    state.client = client;
    state.marketId = $("market").value.trim() || Client.marketIdOf(me);
    if (!state.marketId) log("⚠️ لم يتم العثور على market_id — أدخله يدوياً من الإعدادات المتقدمة");
    await loadProducts();
    setStatus($("connStatus"), `✅ متصل — Market: ${state.marketId || "-"} — المنتجات: ${state.products.length}`, "ok");
  } catch (e) {
    state.client = null;
    setStatus($("connStatus"), "❌ " + e.message, "bad");
    log("❌ " + e.message);
  }
});

$("btnReload").onclick = () => busy(() => loadProducts().catch((e) => log("❌ " + e.message)));

$("btnBackup").onclick = () => busy(async () => {
  const rows = state.products.map((p) => ({
    id: p.id, name_ar: p.name_ar, name_en: p.name_en, category: catName(p),
    description_ar: p.description_ar, description_en: p.description_en, branch_id: p.branch_id, is_active: p.is_active,
    options: (p.options || p.modifiers || []).map((o) => `${o.name_ar || o.name_en} = ${o.price}`).join(" | ") || null,
    json: JSON.stringify(p),
  }));
  saveXlsx(await writeWorkbook({ Products: rows }), `flavours_products_backup_${stamp()}.xlsx`);
  log(`💾 تم تحميل نسخة احتياطية لـ ${rows.length} منتج`);
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
$("btnStop").onclick = () => { state.stop = true; $("btnStop").disabled = true; log("⏹️ سيتوقف الحذف بعد المنتج الحالي…"); };

$("btnDelete").onclick = async () => {
  const list = targets();
  if (!list.length || $("confirmText").value.trim() !== CONFIRM[mode()]) return;
  const what = mode() === "all" ? `كل المنتجات (${list.length})` : `${list.length} منتج محدد`;
  const go = await askConfirm(`سيتم حذف ${what} نهائياً من فليفرز.\nلا يمكن التراجع عن هذه العملية.\n\nمتابعة؟`, { ok: `🗑️ نعم، احذف ${list.length}`, danger: true });
  if (!go) return log("• أُلغي الحذف");
  busy(async () => {
    state.stop = false; $("btnStop").disabled = false;
    $("prog").classList.remove("hidden"); $("prog").value = 0;
    $("result").classList.remove("hidden");
    const report = [];
    let done = 0, failed = 0;
    const show = () => { $("mDone").textContent = done; $("mFail").textContent = failed; $("mLeft").textContent = list.length - report.length; };
    log(`🗑️ بدء حذف ${list.length} منتج…`);
    for (const p of list) {
      if (state.stop) break;
      const row = { id: p.id, name_ar: p.name_ar, name_en: p.name_en, result: "", error: null };
      try {
        await state.client.deleteProduct(p.id);
        row.result = "حُذف"; done++;
        log(`✓ حُذف: ${p.name_ar || p.name_en} (ID ${p.id})`);
      } catch (e) {
        if (e.status === 404) { row.result = "غير موجود"; done++; log(`• غير موجود (ربما حُذف مسبقاً): ID ${p.id}`); }
        else { row.result = "فشل"; row.error = e.message; failed++; log(`❌ فشل حذف ${p.name_ar || p.name_en} (ID ${p.id}): ${e.message}`); }
      }
      report.push(row);
      $("prog").value = report.length / list.length;
      show();
    }
    for (const p of list.slice(report.length)) report.push({ id: p.id, name_ar: p.name_ar, name_en: p.name_en, result: "لم يُنفَّذ (أُوقف)", error: null });
    show();
    state.report = report;
    const stopped = report.some((r) => r.result.startsWith("لم يُنفَّذ"));
    setStatus($("resMsg"),
      `${stopped ? "⏹️ أُوقف الحذف. " : ""}حُذف ${done} من ${list.length}${failed ? ` — فشل ${failed} (التفاصيل في التقرير)` : ""}.`,
      failed ? "bad" : "ok");
    log(`🏁 انتهى: حُذف ${done}، فشل ${failed}${stopped ? "، وأُوقف قبل الباقي" : ""}`);
    $("prog").classList.add("hidden");
    $("confirmText").value = "";
    state.selected.clear();
    await loadProducts().catch((e) => log("❌ تعذّر تحديث القائمة: " + e.message));
  });
};

$("btnReport").onclick = async () => {
  if (state.report) saveXlsx(await writeWorkbook({ Deleted: state.report }), `flavours_delete_report_${stamp()}.xlsx`);
};

(async () => {
  const me = await mountNav("delete");
  if (me.role !== "admin") return $("denied").classList.remove("hidden");
  $("page").classList.remove("hidden");
  const saved = store.get("flv_token");
  if (saved) $("token").value = saved;
  refresh();
})().catch((e) => alert(e.message));
