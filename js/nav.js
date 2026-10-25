// Shared navigation: renders the sidebar (start side; a top bar with a menu button on phones) into
// <nav id="nav">, loads the signed-in user, handles sign-out and the language switch (backed by worker/api/*).
import { L, errorText, langButton } from "./i18n.js";

const LINKS = [
  ["upload", "/#step-1", "🔌", ["1. الاتصال", "1. Connect"]],
  ["upload", "/#step-2", "📄", ["2. القالب", "2. Template"]],
  ["upload", "/#step-3", "⬆️", ["3. الرفع", "3. Upload"]],
  ["upload", "/#log-card", "📜", ["السجل", "Log"]],
  ["delete", "/delete", "🗑️", ["حذف المنتجات", "Delete products"], true],
  ["users", "/users", "👥", ["المستخدمون", "Users"], true],
];

// The owner comes from the server named in Arabic; show it in the current language.
export const displayName = (u) => (u.owner ? L("المالك", "Owner") : u.name);

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== "/api/login") {
    location.href = "/login";
    throw new Error(L("انتهت الجلسة — سجّل الدخول من جديد", "Your session ended — please sign in again"));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(data, `HTTP ${res.status}`));
  return data;
}

// In-page confirmation dialog. Native confirm() is silently refused (returns false, shows nothing)
// in some embedded browsers, which made irreversible buttons look dead. Cancel has focus by default.
export function askConfirm(message, { ok = L("متابعة", "Continue"), danger = false } = {}) {
  let dlg = document.getElementById("confirmDlg");
  if (!dlg) {
    dlg = Object.assign(document.createElement("dialog"), { id: "confirmDlg" });
    dlg.innerHTML = `<form method="dialog">
      <p id="confirmMsg" style="white-space:pre-line;margin:0 0 16px"></p>
      <div class="row" style="margin:0;justify-content:flex-end">
        <button value="cancel" class="sec" id="confirmCancel"></button><button value="ok" id="confirmOk"></button>
      </div></form>`;
    document.body.appendChild(dlg);
  }
  dlg.querySelector("#confirmMsg").textContent = message;
  dlg.querySelector("#confirmCancel").textContent = L("إلغاء", "Cancel");
  const btn = dlg.querySelector("#confirmOk");
  btn.textContent = ok;
  btn.className = danger ? "danger-solid" : "";
  dlg.returnValue = "";
  dlg.showModal();
  dlg.querySelector('button[value="cancel"]').focus();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

// Renders the bar synchronously (again on every language change), then resolves with the signed-in user.
export async function mountNav(page) {
  const nav = document.getElementById("nav");
  nav.className = "sidenav";
  document.body.classList.add("with-side");
  let me = null;

  const render = () => {
    const ver = nav.querySelector("#ver")?.textContent || "";
    const link = ([p, href, icon, [ar, en], admin]) =>
      `<a href="${href}" data-page="${p}"${admin ? ` data-admin class="${me?.role === "admin" ? "" : "hidden"}"` : ""}><span class="ic">${icon}</span>${L(ar, en)}</a>`;
    nav.innerHTML = `
      <div class="side-head">
        <a class="brand" href="/"><img src="/img/flavours-logo.png" alt="Flavours — فليفرز"></a>
        <button class="nav-toggle" id="navToggle" aria-label="${L("القائمة", "Menu")}" aria-expanded="false" aria-controls="navMenu">☰</button>
      </div>
      <div class="side-sub">${L("أداة رفع البيانات", "Data Upload Tool")} <small id="ver">${ver}</small></div>
      <div class="nav-menu" id="navMenu">
        <div class="nav-group">${L("الأداة", "Tool")}</div>
        ${LINKS.filter((l) => !l[4]).map(link).join("")}
        <div class="nav-group${me?.role === "admin" ? "" : " hidden"}" data-admin>${L("الإدارة", "Admin")}</div>
        ${LINKS.filter((l) => l[4]).map(link).join("")}
        <div class="nav-user">
          <span class="who" id="navWho" title="${me?.email ?? ""}">${me ? `👤 ${displayName(me)}` : "…"}</span>
          ${langButton()}
          <button class="out" id="navOut">${L("خروج", "Sign out")}</button>
        </div>
      </div>`;
    nav.querySelector("#navToggle").onclick = (e) => e.currentTarget.setAttribute("aria-expanded", nav.classList.toggle("open"));
    nav.querySelector("#navOut").onclick = async () => {
      await api("/api/logout", { method: "POST" }).catch(() => {});
      location.href = "/login";
    };
    setActive();
  };
  const setActive = () => nav.querySelectorAll(".nav-menu a").forEach((a) => {
    const here = page !== "upload" ? a.dataset.page === page : a.getAttribute("href") === "/" + (location.hash || "#step-1");
    a.classList.toggle("active", here);
  });

  render();
  nav.addEventListener("click", (e) => { if (e.target.closest(".nav-menu a")) nav.classList.remove("open"); });
  addEventListener("hashchange", setActive);
  addEventListener("langchange", render);

  me = await api("/api/me");
  render();
  return me;
}
