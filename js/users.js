// Users page (admins): list, add, edit, delete — backed by worker/api/users.js.
import { L, lang } from "./i18n.js";
import { api, askConfirm, displayName, mountNav } from "./nav.js";

const $ = (id) => document.getElementById(id);
const ROLES = { user: ["مستخدم", "User"], admin: ["مدير", "Admin"] };
const state = { me: null, users: [], editing: null };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "ar-SA-u-nu-latn", { year: "numeric", month: "short", day: "numeric" }) : "—";
const roleName = (u) => (u.owner ? L("مالك", "Owner") : ROLES[u.role] ? L(...ROLES[u.role]) : esc(u.role));

function setMsg(text, cls) {
  $("msg").textContent = text;
  $("msg").className = "status " + cls;
}

function render() {
  $("count").textContent = state.users.length;
  $("rows").innerHTML = state.users.map((u) => {
    const self = u.email === state.me.email;
    const actions = u.owner ? `<span class="hint">${L("يُدار من Cloudflare", "Managed in Cloudflare")}</span>` : `
      <button class="sec sm" data-edit="${esc(u.email)}">${L("تعديل", "Edit")}</button>
      ${self ? "" : `<button class="danger sm" data-del="${esc(u.email)}">${L("حذف", "Delete")}</button>`}`;
    return `<tr>
      <td>${esc(displayName(u))}${self ? ` <span class="hint">${L("(أنت)", "(you)")}</span>` : ""}</td>
      <td><span class="pill">${esc(u.email)}</span></td>
      <td>${roleName(u)}</td>
      <td>${fmtDate(u.created)}</td>
      <td style="white-space:nowrap">${actions}</td></tr>`;
  }).join("");
}

// Title and button follow the form's mode (adding or editing) in the current language.
function renderFormLabels() {
  const u = state.users.find((x) => x.email === state.editing);
  $("formTitle").textContent = u ? L(`✏️ تعديل ${u.name}`, `✏️ Edit ${u.name}`) : L("➕ إضافة مستخدم", "➕ Add a user");
  $("save").textContent = u ? L("حفظ التعديل", "Save changes") : L("إضافة", "Add");
  $("cancel").textContent = L("إلغاء التعديل", "Cancel editing");
}

async function load() {
  state.users = await api("/api/users");
  render();
}

function resetForm() {
  state.editing = null;
  $("form").reset();
  $("email").readOnly = false;
  $("cancel").classList.add("hidden");
  renderFormLabels();
}

function editUser(email) {
  const u = state.users.find((x) => x.email === email);
  if (!u) return;
  state.editing = email;
  $("email").value = u.email; $("email").readOnly = true;
  $("name").value = u.name;
  $("role").value = u.role;
  $("cancel").classList.remove("hidden");
  $("msg").classList.add("hidden");
  renderFormLabels();
  $("formCard").scrollIntoView({ behavior: "smooth" });
}

$("cancel").onclick = () => { resetForm(); $("msg").classList.add("hidden"); };

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("save").disabled = true;
  try {
    const body = { email: $("email").value, name: $("name").value, role: $("role").value };
    const user = await api("/api/users", { method: "POST", body });
    setMsg(state.editing ? L(`✅ تم حفظ تعديلات ${user.name}`, `✅ Saved changes to ${user.name}`)
      : L(`✅ تمت إضافة ${user.name} — يمكنه الدخول الآن بالبريد ${user.email}`, `✅ Added ${user.name} — they can now sign in with ${user.email}`), "ok");
    resetForm();
    await load();
  } catch (err) { setMsg(err.message, "bad"); }
  finally { $("save").disabled = false; }
};

$("rows").onclick = async (e) => {
  const edit = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  if (edit) editUser(edit.dataset.edit);
  if (del) {
    const email = del.dataset.del;
    const ok = await askConfirm(L(`حذف المستخدم ${email}؟ لن يستطيع الدخول بعد ذلك.`, `Delete the user ${email}? They won't be able to sign in anymore.`),
      { ok: L("حذف", "Delete"), danger: true });
    if (!ok) return;
    try {
      await api("/api/users?email=" + encodeURIComponent(email), { method: "DELETE" });
      if (state.editing === email) resetForm();
      setMsg(L(`🗑️ تم حذف ${email}`, `🗑️ Deleted ${email}`), "ok");
      await load();
    } catch (err) { setMsg(err.message, "bad"); }
  }
};

addEventListener("langchange", () => { if (state.me) { render(); renderFormLabels(); } });

(async () => {
  state.me = await mountNav("users");
  if (state.me.role !== "admin") return $("denied").classList.remove("hidden");
  $("formCard").classList.remove("hidden");
  $("listCard").classList.remove("hidden");
  resetForm();
  await load();
})().catch((err) => alert(err.message));
