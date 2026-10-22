// Runs before every request (pages, scripts, templates and /api): only signed-in users get through.
import { configError, fail, sessionUser } from "./auth.js";

const PUBLIC = new Set(["/login", "/login.html", "/js/login.js", "/css/app.css", "/api/login", "/img/flavours-logo.png", "/img/flavours-icon.png"]);

export async function onRequest({ request, env, data, next }) {
  const url = new URL(request.url);
  const problem = configError(env);
  if (problem) return new Response(`إعداد تسجيل الدخول غير مكتمل في Cloudflare: ${problem}`, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });

  // Cookies are SameSite=Lax; also refuse cross-site writes outright.
  const origin = request.headers.get("Origin");
  if (!["GET", "HEAD"].includes(request.method) && origin && origin !== url.origin) return fail("طلب من موقع آخر", 403);

  if (PUBLIC.has(url.pathname)) return next();
  const user = await sessionUser(request, env);
  if (!user) {
    if (url.pathname.startsWith("/api/")) return fail("يجب تسجيل الدخول", 401);
    return Response.redirect(new URL("/login", url), 302);
  }
  data.user = user;
  return next();
}
