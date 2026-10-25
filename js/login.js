// Sign-in page. Imports only i18n.js: everything else is behind the login (see worker/middleware.js PUBLIC).
import { errorText } from "./i18n.js";

const $ = (id) => document.getElementById(id);

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("btn").disabled = true;
  $("msg").classList.add("hidden");
  try {
    const res = await fetch("/api/login", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: $("email").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorText(data, `HTTP ${res.status}`));
    location.href = "/";
  } catch (err) {
    $("msg").textContent = err.message;
    $("msg").classList.remove("hidden");
    $("btn").disabled = false;
  }
};
