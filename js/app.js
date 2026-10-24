import { DEFAULT_BASE_URL } from "./api.js";
import { readWorkbook, saveXlsx as download, stamp, writeWorkbook } from "./excel.js";
import { MODES, connect, loadContext, referenceSheets, upload } from "./uploader.js";
import { askConfirm, mountNav } from "./nav.js";
import { accountTemplate } from "./template.js";

export const VERSION = "2.6.0";
const $ = (id) => document.getElementById(id);
const state = { client: null, ctx: null, sheets: null, fileName: "", busy: false, report: null, step: 1 };
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
  $("btnTpl").disabled = !c || state.busy;
  $("btnDry").disabled = !c || !state.sheets || state.busy;
  $("btnLive").disabled = !c || !state.sheets || state.busy || !$("confirm").checked;
  $("btnConnect").disabled = state.busy;
  $("next1").classList.toggle("hidden", !c);
  paintSteps();
}
async function busy(fn) {
  state.busy = true; refresh();
  try { return await fn(); } finally { state.busy = false; refresh(); }
}

// Steps: one screen at a time, each with its own address (#step-1 connect, #step-2 template, #step-3 upload)
// so the browser's back button works. Steps 2 and 3 need a connection; the old section anchors still land.
const OLD_ANCHORS = { "#connect": 1, "#templates": 2, "#upload": 3 };
function stepFromHash() {
  const m = location.hash.match(/^#step-([123])$/);
  return m ? Number(m[1]) : OLD_ANCHORS[location.hash] ?? null;
}
function paintSteps() {
  const c = !!state.ctx;
  document.querySelectorAll("#stepper li").forEach((li) => {
    const k = Number(li.dataset.step);
    li.classList.toggle("active", k === state.step);
    li.classList.toggle("done", k < state.step || (k === 1 && c));
    li.classList.toggle("locked", k > 1 && !c);
    li.querySelector("button").setAttribute("aria-current", k === state.step ? "step" : "false");
  });
}
function showStep(n) {
  if (n > 1 && !state.ctx) {
    if (location.hash !== "#step-1") { location.hash = "#step-1"; return; }  // hashchange lands here again
    n = 1;
  }
  state.step = n;
  document.querySelectorAll("[data-pane]").forEach((el) => el.classList.toggle("hidden", Number(el.dataset.pane) !== n));
  paintSteps();
  scrollTo({ top: 0, behavior: "smooth" });
}
function goStep(n) {
  if (location.hash === `#step-${n}`) showStep(n); else location.hash = `#step-${n}`;
}
addEventListener("hashchange", () => { const n = stepFromHash(); if (n) showStep(n); });
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) return goStep(Number(go.dataset.go));
  const li = e.target.closest("#stepper li");
  if (li && !li.classList.contains("locked")) goStep(Number(li.dataset.step));
});

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
  showStep(stepFromHash() ?? 1);
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
      أنواع الطلب / التطبيقات: ${ctx.orderTypes.map((o) => `<span class="pill">${o.key}${o.active === false ? " (معطّل)" : ""}</span>`).join("") || "لا يوجد"}`;
    log("✅ تم الاتصال وتحميل البيانات المرجعية");
    setTimeout(() => { if (state.step === 1 && state.ctx === ctx) goStep(2); }, 900);  // let the success show, then move on
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

$("btnTpl").onclick = () => busy(async () => {
  try {
    log("📄 جارٍ تجهيز قالب خاص بحسابك…");
    download(await accountTemplate(state.ctx), `flavours_template_market-${state.ctx.marketId ?? "x"}_${stamp()}.xlsx`);
    log(`✅ تم تحميل القالب — أعمدة التطبيقات: ${state.ctx.orderTypes.filter((t) => t.active !== false).map((t) => t.key).join("، ") || "لا يوجد"}`);
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
    state.ctx.createOrderTypes = $("createTypes").checked;
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
