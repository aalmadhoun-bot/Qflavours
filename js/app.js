import { DEFAULT_BASE_URL } from "./api.js";
import { readWorkbook, saveXlsx as download, stamp, writeWorkbook } from "./excel.js";
import { MODES, connect, loadContext, referenceSheets, upload } from "./uploader.js";
import { askConfirm, mountNav, track } from "./nav.js";
import { accountTemplate } from "./template.js";
import { L } from "./i18n.js";

export const VERSION = "2.11.0";
const $ = (id) => document.getElementById(id);
// conn: "idle" | "connecting" | "ok" | "error" (with connError); summary: last run, so both re-render in the other language
const state = { client: null, ctx: null, sheets: null, fileName: "", busy: false, report: null, step: 1,
  conn: "idle", connError: "", summary: null };
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
  renderModes();
  renderConn();
  $("confirm").onchange = refresh;
  refresh();
  showStep(stepFromHash() ?? 1);
  $("ingBranch").onchange = () => {
    if (!state.ctx) return;
    state.ctx.ingredientBranchId = $("ingBranch").value || null;
    store.set(`flv_branch_${state.ctx.marketId}`, state.ctx.ingredientBranchId);
  };
  addEventListener("langchange", () => { renderModes(); renderConn(); renderResult(); renderBranches(); });
}

function renderModes() {
  const current = document.querySelector("input[name=mode]:checked")?.value;
  $("modes").innerHTML = Object.entries(MODES).map(([k, [ar, en]], i) =>
    `<label><input type="radio" name="mode" value="${k}" ${(current ? k === current : !i) ? "checked" : ""}> ${L(ar, en)}</label>`).join("");
}

// Branch for new ingredients: the account's branches, preselected from the connect form, the only branch,
// or the last choice for this market.
function renderBranches() {
  const ctx = state.ctx, sel = $("ingBranch");
  if (!ctx) { sel.innerHTML = ""; return; }
  const cur = ctx.ingredientBranchId === null || ctx.ingredientBranchId === undefined ? "" : String(ctx.ingredientBranchId);
  const opts = ctx.branches.map((b) => [String(b.id), `${L(b.name_ar || b.name_en, b.name_en || b.name_ar) || "-"} (${b.id})`]);
  if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, cur]);  // branch list unavailable: keep the typed id
  sel.innerHTML = [["", L("— اختر الفرع —", "— Choose the branch —")], ...opts]
    .map(([v, t]) => `<option value="${v}"${v === cur ? " selected" : ""}>${t.replace(/</g, "&lt;")}</option>`).join("");
}

function renderConn() {
  const el = $("connStatus");
  if (state.conn === "connecting") return setStatus(el, L("⏳ جارٍ الاتصال…", "⏳ Connecting…"));
  if (state.conn === "error") return setStatus(el, "❌ " + state.connError, "bad");
  if (state.conn !== "ok") return setStatus(el, L("غير متصل", "Not connected"));
  const { client, ctx } = state;
  el.className = "status ok";
  el.innerHTML = `${L("✅ متصل", "✅ Connected")} — ${client.baseUrl}<br>Market: <span class="pill">${ctx.marketId || "-"}</span>
    ${L("التصنيفات", "Categories")}: <b>${ctx.categories.length}</b> | ${L("المواد الخام", "Ingredients")}: <b>${ctx.ingredients.length}</b><br>
    ${L("أنواع الطلب / التطبيقات", "Order types / apps")}: ${ctx.orderTypes.map((o) => `<span class="pill">${o.key}${o.active === false ? L(" (معطّل)", " (disabled)") : ""}</span>`).join("") || L("لا يوجد", "none")}`;
}

function renderResult() {
  const m = state.summary;
  if (!m) return;
  let msg, cls;
  if (m.blocked) { msg = L("⛔ يوجد أخطاء في الملف — لم يُرفع أي منتج. راجع التقرير وصحّح الأخطاء.", "⛔ The file has errors — no product was uploaded. Check the report and fix the errors."); cls = "bad"; }
  else if (m.dryRun) { msg = L("🔍 فحص فقط — لم يُرفع شيء. راجع التقرير (ورقة Issues) ثم نفّذ الرفع الفعلي.", "🔍 Dry run — nothing was uploaded. Check the report (Issues sheet), then run the live upload."); cls = m.errors ? "bad" : "ok"; }
  else {
    const ing = m.ingredientsCreated || m.ingredientsFailed
      ? L(` المواد الخام: أُنشئ ${m.ingredientsCreated}${m.ingredientsFailed ? ` وفشل ${m.ingredientsFailed}` : ""}.`,
        ` Ingredients: ${m.ingredientsCreated} created${m.ingredientsFailed ? `, ${m.ingredientsFailed} failed` : ""}.`) : "";
    msg = (m.failed ? L(`تم رفع ${m.ok} وفشل ${m.failed} — التفاصيل في التقرير.`, `${m.ok} uploaded, ${m.failed} failed — details in the report.`)
      : L(`✅ تم رفع ${m.ok} منتج بنجاح.`, `✅ ${m.ok} products uploaded successfully.`)) + ing;
    cls = m.failed || m.ingredientsFailed ? "bad" : "ok";
  }
  setStatus($("resMsg"), msg, cls);
}

$("btnConnect").onclick = () => busy(async () => {
  const token = $("token").value.trim();
  if (!token) return alert(L("أدخل مفتاح الـ API", "Enter the API key"));
  store.set("flv_token", $("remember").checked ? token : null);
  const base = $("base").value.trim() || DEFAULT_BASE_URL;
  store.set("flv_base", base === DEFAULT_BASE_URL ? null : base);
  clearLog();
  state.conn = "connecting"; renderConn();
  try {
    const { client, me } = await connect(token, base, log);
    const ctx = await loadContext(client, me, { marketId: $("market").value.trim(), branchId: $("branch").value.trim() }, log);
    const saved = store.get(`flv_branch_${ctx.marketId}`);
    if (!ctx.ingredientBranchId && saved && (!ctx.branches.length || ctx.branchId(saved) !== null)) ctx.ingredientBranchId = saved;
    Object.assign(state, { client, ctx, conn: "ok" });
    renderConn();
    renderBranches();
    log(L("✅ تم الاتصال وتحميل البيانات المرجعية", "✅ Connected and reference data loaded"));
    track("connect", { market: ctx.marketId, page: "upload" });
    setTimeout(() => { if (state.step === 1 && state.ctx === ctx) goStep(2); }, 900);  // let the success show, then move on
  } catch (e) {
    Object.assign(state, { ctx: null, conn: "error", connError: e.message });
    renderConn();
    log("❌ " + e.message);
  }
});

$("btnRef").onclick = () => busy(async () => {
  try {
    log(L("📤 جارٍ تصدير البيانات المرجعية…", "📤 Exporting reference data…"));
    download(await writeWorkbook(await referenceSheets(state.client, state.ctx)), `flavours_reference_${stamp()}.xlsx`);
    log(L("✅ تم تصدير البيانات المرجعية", "✅ Reference data exported"));
    track("reference", { market: state.ctx.marketId });
  } catch (e) { log("❌ " + e.message); alert(e.message); }
});

$("btnTpl").onclick = () => busy(async () => {
  try {
    log(L("📄 جارٍ تجهيز قالب خاص بحسابك…", "📄 Preparing a template for your account…"));
    download(await accountTemplate(state.ctx), `flavours_template_market-${state.ctx.marketId ?? "x"}_${stamp()}.xlsx`);
    track("template", { market: state.ctx.marketId });
    const cols = state.ctx.orderTypes.filter((t) => t.active !== false).map((t) => t.key);
    log(L(`✅ تم تحميل القالب — أعمدة التطبيقات: ${cols.join("، ") || "لا يوجد"}`, `✅ Template downloaded — app columns: ${cols.join(", ") || "none"}`));
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
    $("counts").textContent = L("تعذّر قراءة الملف: ", "Could not read the file: ") + e.message;
  }
  refresh();
}

async function run(live) {
  if (live && !(await askConfirm(L("سيتم رفع البيانات فعلياً على فليفرز. متابعة؟", "The data will be uploaded to Flavours for real. Continue?"), { ok: L("🚀 رفع فعلي", "🚀 Live upload") }))) return;
  busy(async () => {
    clearLog();
    $("prog").classList.remove("hidden"); $("prog").value = 0; $("result").classList.add("hidden");
    state.ctx.createCategories = $("createCats").checked;
    state.ctx.createOrderTypes = $("createTypes").checked;
    state.ctx.createIngredients = $("createIngs").checked;
    state.ctx.ingredientBranchId = $("ingBranch").value || null;
    try {
      const out = await upload(state.client, state.ctx, structuredClone(state.sheets), {
        mode: document.querySelector("input[name=mode]:checked").value,
        dryRun: !live, allowPartial: $("partial").checked, log,
        progress: (n, t) => { $("prog").value = n / Math.max(t, 1); },
      });
      const m = out.summary;
      $("mReady").textContent = m.ready; $("mOk").textContent = m.ok; $("mFail").textContent = m.failed;
      $("mErr").textContent = m.errors; $("mWarn").textContent = m.warnings;
      state.summary = m;
      renderResult();
      track(live ? "upload" : "dry_run", { market: state.ctx.marketId, ready: m.ready, ok: m.ok, failed: m.failed, errors: m.errors, warnings: m.warnings });
      state.report = { results: out.results, issues: out.issues, ingredients: out.ingredients };
      $("result").classList.remove("hidden");
    } catch (e) { log("❌ " + e.message); alert(e.message); }
    finally { $("prog").classList.add("hidden"); }
  });
}
$("btnDry").onclick = () => run(false);
$("btnLive").onclick = () => run(true);
$("btnReport").onclick = async () => {
  if (!state.report) return;
  const { results, issues, ingredients } = state.report;
  download(await writeWorkbook({ Results: results, ...(ingredients?.length ? { Ingredients: ingredients } : {}), Issues: issues }), `flavours_report_${stamp()}.xlsx`);
  track("report", { market: state.ctx?.marketId });
};

init();
