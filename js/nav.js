// Shared navigation: renders the right-hand sidebar (a top bar with a menu button on phones) into
// <nav id="nav">, loads the signed-in user, and handles sign-out (backed by worker/api/*).

const LINKS = [
  ["upload", "/#step-1", "🔌", "1. الاتصال"],
  ["upload", "/#step-2", "📄", "2. القالب"],
  ["upload", "/#step-3", "⬆️", "3. الرفع"],
  ["upload", "/#log-card", "📜", "السجل"],
  ["delete", "/delete", "🗑️", "حذف المنتجات", true],
  ["users", "/users", "👥", "المستخدمون", true],
];

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== "/api/login") {
    location.href = "/login";
    throw new Error("انتهت الجلسة — سجّل الدخول من جديد");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// In-page confirmation dialog. Native confirm() is silently refused (returns false, shows nothing)
// in some embedded browsers, which made irreversible buttons look dead. Cancel has focus by default.
export function askConfirm(message, { ok = "متابعة", danger = false } = {}) {
  let dlg = document.getElementById("confirmDlg");
  if (!dlg) {
    dlg = Object.assign(document.createElement("dialog"), { id: "confirmDlg" });
    dlg.innerHTML = `<form method="dialog">
      <p id="confirmMsg" style="white-space:pre-line;margin:0 0 16px"></p>
      <div class="row" style="margin:0;justify-content:flex-end">
        <button value="cancel" class="sec">إلغاء</button><button value="ok" id="confirmOk"></button>
      </div></form>`;
    document.body.appendChild(dlg);
  }
  dlg.querySelector("#confirmMsg").textContent = message;
  const btn = dlg.querySelector("#confirmOk");
  btn.textContent = ok;
  btn.className = danger ? "danger-solid" : "";
  dlg.returnValue = "";
  dlg.showModal();
  dlg.querySelector('button[value="cancel"]').focus();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

// Renders the bar synchronously, then resolves with the signed-in user.
export async function mountNav(page) {
  const nav = document.getElementById("nav");
  nav.className = "sidenav";
  document.body.classList.add("with-side");
  const link = ([p, href, icon, text, admin]) =>
    `<a href="${href}" data-page="${p}"${admin ? ' data-admin class="hidden"' : ""}><span class="ic">${icon}</span>${text}</a>`;
  nav.innerHTML = `
    <div class="side-head">
      <a class="brand" href="/"><img src="/img/flavours-logo.png" alt="فليفرز"></a>
      <button class="nav-toggle" id="navToggle" aria-label="القائمة" aria-expanded="false" aria-controls="navMenu">☰</button>
    </div>
    <div class="side-sub">أداة رفع البيانات <small id="ver"></small></div>
    <div class="nav-menu" id="navMenu">
      <div class="nav-group">الأداة</div>
      ${LINKS.filter((l) => !l[4]).map(link).join("")}
      <div class="nav-group hidden" data-admin>الإدارة</div>
      ${LINKS.filter((l) => l[4]).map(link).join("")}
      <div class="nav-user">
        <span class="who" id="navWho">…</span>
        <button id="navOut">خروج</button>
      </div>
    </div>`;

  const $ = (id) => nav.querySelector("#" + id);
  $("navToggle").onclick = () => $("navToggle").setAttribute("aria-expanded", nav.classList.toggle("open"));
  $("navMenu").addEventListener("click", (e) => { if (e.target.closest("a")) nav.classList.remove("open"); });
  const setActive = () => nav.querySelectorAll(".nav-menu a").forEach((a) => {
    const here = page !== "upload" ? a.dataset.page === page : a.getAttribute("href") === "/" + (location.hash || "#step-1");
    a.classList.toggle("active", here);
  });
  setActive();
  addEventListener("hashchange", setActive);

  $("navOut").onclick = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    location.href = "/login";
  };

  const me = await api("/api/me");
  $("navWho").textContent = `👤 ${me.name}`;
  $("navWho").title = me.email;
  if (me.role === "admin") nav.querySelectorAll("[data-admin]").forEach((a) => a.classList.remove("hidden"));
  return me;
}
