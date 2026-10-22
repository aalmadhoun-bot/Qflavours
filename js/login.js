// Sign-in page. Kept free of other imports: everything except this page is behind the login.
const $ = (id) => document.getElementById(id);

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("btn").disabled = true;
  $("msg").classList.add("hidden");
  try {
    const res = await fetch("/api/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: $("email").value, password: $("password").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    location.href = "/";
  } catch (err) {
    $("msg").textContent = err.message;
    $("msg").classList.remove("hidden");
    $("btn").disabled = false;
  }
};
