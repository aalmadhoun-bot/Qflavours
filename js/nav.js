// Shared top navigation: renders the bar into <nav id="nav">, loads the signed-in user,
// and handles sign-out (backed by worker/api/*).

const LINKS = [
  ["upload", "/#connect", "الاتصال"],
  ["upload", "/#templates", "القوالب"],
  ["upload", "/#upload", "الرفع"],
  ["upload", "/#log-card", "السجل"],
  ["delete", "/delete", "حذف المنتجات", true],
  ["users", "/users", "المستخدمون", true],
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

// Renders the bar synchronously, then resolves with the signed-in user.
export async function mountNav(page) {
  const nav = document.getElementById("nav");
  nav.className = "topnav";
  nav.innerHTML = `
    <div class="nav-in">
      <a class="brand" href="/">🍔 <span>أداة رفع بيانات فليفرز</span> <small id="ver"></small></a>
      <button class="nav-toggle" id="navToggle" aria-label="القائمة" aria-expanded="false" aria-controls="navMenu">☰</button>
      <div class="nav-menu" id="navMenu">
        ${LINKS.map(([p, href, text, admin]) =>
          `<a href="${href}" data-page="${p}"${admin ? ' data-admin class="hidden"' : ""}>${text}</a>`).join("")}
        <div class="nav-user">
          <span class="who" id="navWho">…</span>
          <button id="navOut">خروج</button>
        </div>
      </div>
    </div>`;

  const $ = (id) => nav.querySelector("#" + id);
  $("navToggle").onclick = () => $("navToggle").setAttribute("aria-expanded", nav.classList.toggle("open"));
  $("navMenu").addEventListener("click", (e) => { if (e.target.closest("a")) nav.classList.remove("open"); });
  const setActive = () => nav.querySelectorAll(".nav-menu a").forEach((a) => {
    const here = page !== "upload" ? a.dataset.page === page : a.getAttribute("href") === "/" + (location.hash || "#connect");
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
