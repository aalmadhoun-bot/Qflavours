// Shared top navigation: renders the bar into <nav id="nav">, loads the signed-in user,
// and handles password change and sign-out (backed by functions/api/*).

const LINKS = [
  ["upload", "/#connect", "الاتصال"],
  ["upload", "/#templates", "القوالب"],
  ["upload", "/#upload", "الرفع"],
  ["upload", "/#log-card", "السجل"],
  ["users", "/users", "المستخدمون", true],
];

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== "/api/login" && path !== "/api/password") {
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
          <button id="navPw" class="hidden">🔑 كلمة المرور</button>
          <button id="navOut">خروج</button>
        </div>
      </div>
    </div>
    <dialog id="pwDlg">
      <form id="pwForm" method="dialog">
        <h3>تغيير كلمة المرور</h3>
        <div class="grid">
          <div><label>كلمة المرور الحالية</label><input id="pwCur" type="password" autocomplete="current-password" required></div>
          <div><label>كلمة المرور الجديدة (8 أحرف على الأقل)</label><input id="pwNew" type="password" autocomplete="new-password" minlength="8" required></div>
          <div><label>تأكيد كلمة المرور الجديدة</label><input id="pwNew2" type="password" autocomplete="new-password" minlength="8" required></div>
        </div>
        <div id="pwMsg" class="status hidden"></div>
        <div class="row"><button type="submit" value="save">حفظ</button><button type="button" class="sec" id="pwCancel">إلغاء</button></div>
      </form>
    </dialog>`;

  const $ = (id) => nav.querySelector("#" + id);
  $("navToggle").onclick = () => $("navToggle").setAttribute("aria-expanded", nav.classList.toggle("open"));
  $("navMenu").addEventListener("click", (e) => { if (e.target.closest("a")) nav.classList.remove("open"); });
  const setActive = () => nav.querySelectorAll(".nav-menu a").forEach((a) => {
    const here = page === "users" ? a.dataset.page === "users" : a.getAttribute("href") === "/" + (location.hash || "#connect");
    a.classList.toggle("active", here);
  });
  setActive();
  addEventListener("hashchange", setActive);

  $("navOut").onclick = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    location.href = "/login";
  };
  const dlg = $("pwDlg"), msg = $("pwMsg");
  $("navPw").onclick = () => { $("pwForm").reset(); msg.classList.add("hidden"); dlg.showModal(); };
  $("pwCancel").onclick = () => dlg.close();
  $("pwForm").onsubmit = async (e) => {
    e.preventDefault();
    const show = (text, cls) => { msg.textContent = text; msg.className = "status " + cls; };
    if ($("pwNew").value !== $("pwNew2").value) return show("كلمتا المرور غير متطابقتين", "bad");
    try {
      await api("/api/password", { method: "POST", body: { current: $("pwCur").value, password: $("pwNew").value } });
      show("✅ تم تغيير كلمة المرور", "ok");
      setTimeout(() => dlg.close(), 900);
    } catch (err) { show(err.message, "bad"); }
  };

  const me = await api("/api/me");
  $("navWho").textContent = `👤 ${me.name}`;
  $("navWho").title = me.email;
  $("navPw").classList.toggle("hidden", me.owner);
  if (me.role === "admin") nav.querySelectorAll("[data-admin]").forEach((a) => a.classList.remove("hidden"));
  return me;
}
