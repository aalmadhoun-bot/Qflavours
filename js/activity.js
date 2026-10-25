// Usage report (admins): reads the usage log (worker/api/activity.js) for a period and shows totals,
// a row per user (including users with no activity) and the event list; exports both to Excel.
import { saveXlsx, stamp, writeWorkbook } from "./excel.js";
import { L, lang } from "./i18n.js";
import { api, displayName, mountNav } from "./nav.js";

const $ = (id) => document.getElementById(id);
const DAY = 86400e3;
const DOWNLOADS = new Set(["template", "reference", "report", "backup", "delete_report"]);
const ACTION_NAMES = {
  login: ["تسجيل دخول", "Sign-in"], connect: ["اتصال بحساب", "Account connection"],
  dry_run: ["فحص فقط", "Dry run"], upload: ["رفع فعلي", "Live upload"], delete: ["حذف منتجات", "Product deletion"],
  template: ["تحميل القالب الجاهز", "Account template download"], reference: ["تصدير البيانات المرجعية", "Reference data export"],
  report: ["تحميل تقرير الرفع", "Upload report download"], backup: ["نسخة احتياطية للمنتجات", "Products backup"],
  delete_report: ["تحميل تقرير الحذف", "Deletion report download"],
};
const state = { data: null, who: "" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const locale = () => (lang === "en" ? "en-GB" : "ar-SA-u-nu-latn");
const fmtTime = (t) => new Date(t).toLocaleString(locale(), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const actionName = (a) => (ACTION_NAMES[a] ? L(...ACTION_NAMES[a]) : a);
const isoDay = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);

// What one event says beyond its type, e.g. "12 ok, 1 failed".
function details(ev) {
  const n = (k) => ev[k] ?? 0;
  switch (ev.a) {
    case "dry_run": return L(`جاهز ${n("ready")} — أخطاء ${n("errors")} — تحذيرات ${n("warnings")}`, `${n("ready")} ready — ${n("errors")} errors — ${n("warnings")} warnings`);
    case "upload": return L(`نجح ${n("ok")} — فشل ${n("failed")} من ${n("ready")}`, `${n("ok")} ok — ${n("failed")} failed of ${n("ready")}`);
    case "delete": return L(`حُذف ${n("deleted")} — فشل ${n("failed")} من ${n("total")}`, `${n("deleted")} deleted — ${n("failed")} failed of ${n("total")}`);
    case "backup": return L(`${n("products")} منتج`, `${n("products")} products`);
    case "connect": return ev.p === "delete" ? L("من صفحة الحذف", "from the delete page") : "";
    default: return "";
  }
}

function period() {
  const v = $("period").value;
  if (v !== "custom") return { from: Date.now() - Number(v) * DAY, to: Date.now() };
  const from = $("from").value ? new Date($("from").value + "T00:00:00").getTime() : Date.now() - 30 * DAY;
  const to = $("to").value ? new Date($("to").value + "T23:59:59").getTime() : Date.now();
  return { from, to };
}

// One row per user: everyone registered, plus anyone in the log who has since been removed.
function summarize(events, users) {
  const rows = new Map(users.map((u) => [u.email, { user: u, login: 0, connect: 0, dry_run: 0, upload: 0, uploaded: 0, upFailed: 0,
    delete: 0, deleted: 0, delFailed: 0, downloads: 0, markets: new Set(), last: 0 }]));
  for (const ev of events) {
    if (!rows.has(ev.e)) rows.set(ev.e, { user: { email: ev.e, name: ev.e, removed: true }, login: 0, connect: 0, dry_run: 0, upload: 0,
      uploaded: 0, upFailed: 0, delete: 0, deleted: 0, delFailed: 0, downloads: 0, markets: new Set(), last: 0 });
    const r = rows.get(ev.e);
    if (ev.a in r) r[ev.a]++;
    if (ev.a === "upload") { r.uploaded += ev.ok ?? 0; r.upFailed += ev.failed ?? 0; }
    if (ev.a === "delete") { r.deleted += ev.deleted ?? 0; r.delFailed += ev.failed ?? 0; }
    if (DOWNLOADS.has(ev.a)) r.downloads++;
    if (ev.m) r.markets.add(ev.m);
    r.last = Math.max(r.last, ev.t);
  }
  return [...rows.values()].sort((a, b) => b.last - a.last || String(a.user.email).localeCompare(b.user.email));
}

const COLUMNS = () => [
  ["user", L("المستخدم", "User")], ["login", L("دخول", "Sign-ins")], ["connect", L("اتصالات", "Connections")],
  ["dry_run", L("فحص", "Dry runs")], ["upload", L("رفع فعلي", "Live uploads")], ["uploaded", L("منتجات رُفعت", "Products uploaded")],
  ["delete", L("عمليات حذف", "Deletions")], ["deleted", L("منتجات حُذفت", "Products deleted")],
  ["downloads", L("تحميلات", "Downloads")], ["markets", L("الحسابات (Market)", "Accounts (Market)")], ["last", L("آخر نشاط", "Last activity")],
];
const userLabel = (u) => (u.removed ? `${u.email} ${L("(محذوف)", "(removed)")}` : displayName(u));

function render() {
  const d = state.data;
  if (!d) return;
  const events = state.who ? d.events.filter((e) => e.e === state.who) : d.events;
  const rows = summarize(events, state.who ? d.users.filter((u) => u.email === state.who) : d.users);
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);

  $("kpis").innerHTML = [
    [rows.filter((r) => r.last).length, L("مستخدمون نشطون", "Active users")],
    [sum("login"), L("تسجيلات دخول", "Sign-ins")],
    [sum("upload"), L("عمليات رفع فعلي", "Live uploads")],
    [sum("uploaded"), L("منتجات رُفعت", "Products uploaded")],
    [sum("deleted"), L("منتجات حُذفت", "Products deleted")],
    [sum("downloads"), L("تحميلات", "Downloads")],
  ].map(([v, t]) => `<div class="metric"><b>${v}</b>${t}</div>`).join("");

  const cols = COLUMNS();
  $("sumHead").innerHTML = `<tr>${cols.map(([, t]) => `<th>${t}</th>`).join("")}</tr>`;
  $("sumRows").innerHTML = rows.map((r) => `<tr class="clickable${state.who === r.user.email ? " picked" : ""}" data-email="${esc(r.user.email)}">${cols.map(([k]) => {
    if (k === "user") return `<td><b>${esc(userLabel(r.user))}</b><div class="hint">${esc(r.user.email)}</div></td>`;
    if (k === "markets") return `<td>${[...r.markets].map((m) => `<span class="pill">${esc(m)}</span>`).join("") || "—"}</td>`;
    if (k === "last") return `<td>${r.last ? fmtTime(r.last) : `<span class="hint">${L("لا يوجد نشاط", "No activity")}</span>`}</td>`;
    const failedN = k === "uploaded" ? r.upFailed : k === "deleted" ? r.delFailed : 0;
    const fail = failedN ? `<span class="bad-n" title="${L("فشل", "Failed")}">✗${failedN}</span>` : "";
    return `<td class="${r[k] || failedN ? "" : "zero"}">${r[k]}${fail}</td>`;
  }).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="hint">${L("لا يوجد مستخدمون", "No users")}</td></tr>`;

  const MAX = 500;
  const recent = [...events].reverse();
  $("evCount").textContent = events.length;
  $("evHead").innerHTML = `<tr><th>${L("الوقت", "Time")}</th><th>${L("المستخدم", "User")}</th><th>${L("النشاط", "Activity")}</th><th>Market</th><th>${L("التفاصيل", "Details")}</th></tr>`;
  const nameOf = new Map(d.users.map((u) => [u.email, displayName(u)]));
  $("evRows").innerHTML = recent.slice(0, MAX).map((ev) => `<tr>
    <td style="white-space:nowrap">${fmtTime(ev.t)}</td><td>${esc(nameOf.get(ev.e) || ev.e)}</td>
    <td>${actionName(ev.a)}</td><td>${ev.m ? `<span class="pill">${esc(ev.m)}</span>` : "—"}</td><td>${esc(details(ev))}</td></tr>`).join("")
    || `<tr><td colspan="5" class="hint">${L("لا يوجد نشاط في هذه الفترة", "No activity in this period")}</td></tr>`;
  $("evNote").textContent = events.length > MAX
    ? L(`يُعرض آخر ${MAX} نشاط — الكل موجود في ملف Excel.`, `Showing the latest ${MAX} — all of them are in the Excel export.`) : "";

  const current = $("who").value;
  $("who").innerHTML = `<option value="">${L("كل المستخدمين", "All users")}</option>`
    + summarize(d.events, d.users).map((r) => `<option value="${esc(r.user.email)}">${esc(userLabel(r.user))} — ${esc(r.user.email)}</option>`).join("");
  $("who").value = current;
  $("btnExport").disabled = false;
}

async function load() {
  const { from, to } = period();
  $("btnLoad").disabled = true;
  try {
    state.data = await api(`/api/activity?from=${Math.round(from)}&to=${Math.round(to)}`);
    render();
  } catch (e) { alert(e.message); }
  finally { $("btnLoad").disabled = false; }
}

$("period").onchange = () => {
  const custom = $("period").value === "custom";
  document.querySelectorAll(".filters .custom").forEach((el) => el.classList.toggle("hidden", !custom));
  if (custom && !$("from").value) { $("from").value = isoDay(Date.now() - 30 * DAY); $("to").value = isoDay(Date.now()); }
  if (!custom) load();
};
$("from").onchange = $("to").onchange = load;
$("btnLoad").onclick = load;
$("who").onchange = () => { state.who = $("who").value; render(); };
$("sumRows").onclick = (e) => {
  const tr = e.target.closest("tr[data-email]");
  if (!tr) return;
  state.who = state.who === tr.dataset.email ? "" : tr.dataset.email;  // click again to show everyone
  $("who").value = state.who;
  render();
  if (state.who) document.getElementById("evRows").closest(".card").scrollIntoView({ behavior: "smooth" });
};

$("btnExport").onclick = async () => {
  const d = state.data;
  const events = state.who ? d.events.filter((e) => e.e === state.who) : d.events;
  const cols = COLUMNS();
  const cell = (r, k) => (k === "user" ? userLabel(r.user) : k === "markets" ? [...r.markets].join(", ") : k === "last" ? (r.last ? fmtTime(r.last) : "") : r[k]);
  const summary = summarize(events, state.who ? d.users.filter((u) => u.email === state.who) : d.users)
    .map((r) => Object.fromEntries([...cols.map(([k, t]) => [t, cell(r, k)]),
      [L("فشل رفعها", "Upload failures"), r.upFailed], [L("فشل حذفها", "Deletion failures"), r.delFailed], [L("البريد", "Email"), r.user.email]]));
  const nameOf = new Map(d.users.map((u) => [u.email, displayName(u)]));
  const log = [...events].reverse().map((ev) => ({
    [L("الوقت", "Time")]: fmtTime(ev.t), [L("المستخدم", "User")]: nameOf.get(ev.e) || ev.e, [L("البريد", "Email")]: ev.e,
    [L("النشاط", "Activity")]: actionName(ev.a), Market: ev.m ?? "", [L("التفاصيل", "Details")]: details(ev),
  }));
  saveXlsx(await writeWorkbook({ [L("الملخص", "Summary")]: summary, [L("النشاط", "Activity")]: log }), `flavours_usage_${isoDay(Date.now())}_${stamp()}.xlsx`);
};

addEventListener("langchange", render);

(async () => {
  const me = await mountNav("activity");
  if (me.role !== "admin") return $("denied").classList.remove("hidden");
  $("page").classList.remove("hidden");
  await load();
})().catch((e) => alert(e.message));
