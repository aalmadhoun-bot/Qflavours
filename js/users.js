// Users page (admins): list, add, edit, delete — backed by worker/api/users.js.
import { api, mountNav } from "./nav.js";

const $ = (id) => document.getElementById(id);
const ROLES = { user: "مستخدم", admin: "مدير" };
const state = { me: null, users: [], editing: null };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "short", day: "numeric" }) : "—";

function setMsg(text, cls) {
  $("msg").textContent = text;
  $("msg").className = "status " + cls;
}

function render() {
  $("count").textContent = state.users.length;
  $("rows").innerHTML = state.users.map((u) => {
    const self = u.email === state.me.email;
    const actions = u.owner ? '<span class="hint">يُدار من Cloudflare</span>' : `
      <button class="sec sm" data-edit="${esc(u.email)}">تعديل</button>
      ${self ? "" : `<button class="danger sm" data-del="${esc(u.email)}">حذف</button>`}`;
    return `<tr>
      <td>${esc(u.name)}${self ? ' <span class="hint">(أنت)</span>' : ""}</td>
      <td><span class="pill">${esc(u.email)}</span></td>
      <td>${u.owner ? "مالك" : ROLES[u.role] || esc(u.role)}</td>
      <td>${fmtDate(u.created)}</td>
      <td style="white-space:nowrap">${actions}</td></tr>`;
  }).join("");
}

async function load() {
  state.users = await api("/api/users");
  render();
}

function resetForm() {
  state.editing = null;
  $("form").reset();
  $("email").readOnly = false;
  $("formTitle").textContent = "➕ إضافة مستخدم";
  $("save").textContent = "إضافة";
  $("cancel").classList.add("hidden");
}

function editUser(email) {
  const u = state.users.find((x) => x.email === email);
  if (!u) return;
  state.editing = email;
  $("email").value = u.email; $("email").readOnly = true;
  $("name").value = u.name;
  $("role").value = u.role;
  $("formTitle").textContent = "✏️ تعديل " + u.name;
  $("save").textContent = "حفظ التعديل";
  $("cancel").classList.remove("hidden");
  $("msg").classList.add("hidden");
  $("formCard").scrollIntoView({ behavior: "smooth" });
}

$("cancel").onclick = () => { resetForm(); $("msg").classList.add("hidden"); };

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("save").disabled = true;
  try {
    const body = { email: $("email").value, name: $("name").value, role: $("role").value };
    const user = await api("/api/users", { method: "POST", body });
    setMsg(state.editing ? `✅ تم حفظ تعديلات ${user.name}` : `✅ تمت إضافة ${user.name} — يمكنه الدخول الآن بالبريد ${user.email}`, "ok");
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
    if (!confirm(`حذف المستخدم ${email}؟ لن يستطيع الدخول بعد ذلك.`)) return;
    try {
      await api("/api/users?email=" + encodeURIComponent(email), { method: "DELETE" });
      if (state.editing === email) resetForm();
      setMsg(`🗑️ تم حذف ${email}`, "ok");
      await load();
    } catch (err) { setMsg(err.message, "bad"); }
  }
};

(async () => {
  state.me = await mountNav("users");
  if (state.me.role !== "admin") return $("denied").classList.remove("hidden");
  $("formCard").classList.remove("hidden");
  $("listCard").classList.remove("hidden");
  resetForm();
  await load();
})().catch((err) => alert(err.message));
