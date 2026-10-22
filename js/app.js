import { DEFAULT_BASE_URL } from "./api.js";
import { readWorkbook, saveXlsx as download, stamp, writeWorkbook } from "./excel.js";
import { MODES, connect, loadContext, referenceSheets, upload } from "./uploader.js";
import { askConfirm, mountNav } from "./nav.js";

export const VERSION = "2.4.0";
const $ = (id) => document.getElementById(id);
const state = { client: null, ctx: null, sheets: null, fileName: "", busy: false, report: null };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

function log(msg) {
  const el = $("log");
  el.textContent = (el.textContent === "—" ? "" : el.textContent + "\n") + msg;
  el.scrollTop = el.scrollHeight;
}
function clearLog() { $("log").textContent = ""; }
function setStatus(el, text, cls = "") { el.textContent = text; el.className = "status" + (cls ? " " + cls : ""); }
function refresh() {
  const c = !!state.ctx;
  $("btnRef").disabled = !c || state.busy;
  $("btnDry").disabled = !c || !state.sheets || state.busy;
  $("btnLive").disabled = !c || !state.sheets || state.busy || !$("confirm").checked;
  $("btnConnect").disabled = state.busy;
}
async function busy(fn) {
  state.busy = true; refresh();
  try { return await fn(); } finally { state.busy = false; refresh(); }
}

function init() {
  mountNav("upload").catch((e) => log("❌ " + e.message));
  $("ver").textContent = "v" + VERSION;
  $("base").value = store.get("flv_base") || DEFAULT_BASE_URL;
  const saved = store.get("flv_token");
  if (saved) { $("token").value = saved; $("remember").checked = true; }
  $("modes").innerHTML = Object.entries(MODES)
    .map(([k, v], i) => `<label><input type="radio" name="mode" value="${k}" ${i ? "" : "checked"}> ${v}</label>`).join("");
  $("confirm").onchange = refresh;
  refresh();
}

$("btnConnect").onclick = () => busy(async () => {
  const token = $("token").value.trim();
  if (!token) return alert("أدخل مفتاح الـ API");
  store.set("flv_token", $("remember").checked ? token : null);
  const base = $("base").value.trim() || DEFAULT_BASE_URL;
  store.set("flv_base", base === DEFAULT_BASE_URL ? null : base);
  clearLog();
  setStatus($("connStatus"), "⏳ جارٍ الاتصال…");
  try {
    const { client, me } = await connect(token, base, log);
    const ctx = await loadContext(client, me, { marketId: $("market").value.trim(), branchId: $("branch").value.trim() }, log);
    Object.assign(state, { client, ctx });
    $("connStatus").className = "status ok";
    $("connStatus").innerHTML = `✅ متصل — ${client.baseUrl}<br>Market: <span class="pill">${ctx.marketId || "-"}</span>
      التصنيفات: <b>${ctx.categories.length}</b> | المواد الخام: <b>${ctx.ingredients.length}</b><br>
      أنواع الطلب / التطبيقات: ${ctx.orderTypes.map((o) => `<span class="pill">${o.key}</span>`).join("") || "لم تُجلب"}`;
    log("✅ تم الاتصال وتحميل البيانات المرجعية");
  } catch (e) {
    state.ctx = null;
    setStatus($("connStatus"), "❌ " + e.message, "bad");
    log("❌ " + e.message);
  }
});

$("btnRef").onclick = () => busy(async () => {
  try {
    log("📤 جارٍ تصدير البيانات المرجعية…");
    download(await writeWorkbook(await referenceSheets(state.client, state.ctx)), `flavours_reference_${stamp()}.xlsx`);
    log("✅ تم تصدير البيانات المرجعية");
  } catch (e) { log("❌ " + e.message); alert(e.message); }
});

const drop = $("drop");
drop.onclick = () => $("file").click();
drop.ondragover = (e) => e.preventDefault();
drop.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); };
$("file").onchange = (e) => e.target.files[0] && loadFile(e.target.files[0]);

async function loadFile(f) {
  try {
    state.sheets = await readWorkbook(await f.arrayBuffer());
    state.fileName = f.name;
    drop.textContent = "📄 " + f.name; drop.classList.add("has");
    $("counts").innerHTML = Object.entries(state.sheets).map(([k, v]) => `${k}: <b>${v.length}</b>`).join(" &nbsp;|&nbsp; ");
  } catch (e) {
    state.sheets = null;
    $("counts").textContent = "تعذّر قراءة الملف: " + e.message;
  }
  refresh();
}

async function run(live) {
  if (live && !(await askConfirm("سيتم رفع البيانات فعلياً على فليفرز. متابعة؟", { ok: "🚀 رفع فعلي" }))) return;
  busy(async () => {
    clearLog();
    $("prog").classList.remove("hidden"); $("prog").value = 0; $("result").classList.add("hidden");
    state.ctx.createCategories = $("createCats").checked;
    try {
      const out = await upload(state.client, state.ctx, structuredClone(state.sheets), {
        mode: document.querySelector("input[name=mode]:checked").value,
        dryRun: !live, allowPartial: $("partial").checked, log,
        progress: (n, t) => { $("prog").value = n / Math.max(t, 1); },
      });
      const m = out.summary;
      $("mReady").textContent = m.ready; $("mOk").textContent = m.ok; $("mFail").textContent = m.failed;
      $("mErr").textContent = m.errors; $("mWarn").textContent = m.warnings;
      let msg, cls;
      if (m.blocked) { msg = "⛔ يوجد أخطاء في الملف — لم يُرفع أي منتج. راجع التقرير وصحّح الأخطاء."; cls = "bad"; }
      else if (m.dryRun) { msg = "🔍 فحص فقط — لم يُرفع شيء. راجع التقرير (ورقة Issues) ثم نفّذ الرفع الفعلي."; cls = m.errors ? "bad" : "ok"; }
      else { msg = m.failed ? `تم رفع ${m.ok} وفشل ${m.failed} — التفاصيل في التقرير.` : `✅ تم رفع ${m.ok} منتج بنجاح.`; cls = m.failed ? "bad" : "ok"; }
      setStatus($("resMsg"), msg, cls);
      state.report = { results: out.results, issues: out.issues };
      $("result").classList.remove("hidden");
    } catch (e) { log("❌ " + e.message); alert(e.message); }
    finally { $("prog").classList.add("hidden"); }
  });
}
$("btnDry").onclick = () => run(false);
$("btnLive").onclick = () => run(true);
$("btnReport").onclick = async () => {
  if (!state.report) return;
  download(await writeWorkbook({ Results: state.report.results, Issues: state.report.issues }), `flavours_report_${stamp()}.xlsx`);
};

init();
