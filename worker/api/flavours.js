// Forwards /api/flavours/<path> to the Q-Flavours API with the user's key in the API-TOKEN header.
// Browsers can't send API-TOKEN there (its CORS policy only allows Authorization); a server can.
// Only signed-in users get here (middleware). The key is passed through, never stored or logged.
import { fail } from "../auth.js";

export const FLAVOURS_API = "https://qflavours-api.qoyod.com/pos/api/v2";
export const PREFIX = "/api/flavours/";
const PASS_IN = ["accept", "content-type", "x-api-version", "accept-language"];
const PASS_OUT = ["content-type", "retry-after"];

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = new URL(`${FLAVOURS_API}/${url.pathname.slice(PREFIX.length)}${url.search}`);
  if (!target.href.startsWith(FLAVOURS_API + "/") || target.href === FLAVOURS_API + "/") return fail("مسار غير صالح");
  const token = request.headers.get("X-Flavours-Token");
  if (!token) return fail("مفتاح الـ API مفقود");

  const headers = new Headers({ "API-TOKEN": token });
  for (const h of PASS_IN) { const v = request.headers.get(h); if (v) headers.set(h, v); }
  const init = { method: request.method, headers };
  if (!["GET", "HEAD"].includes(request.method)) init.body = await request.text();

  let res;
  try { res = await fetch(target, init); }
  catch (e) { return fail(`تعذّر الوصول إلى خادم فليفرز من الـ Worker: ${e.message}`, 502); }
  const out = new Headers({ "cache-control": "no-store", "x-flavours-proxy": "1" });
  for (const h of PASS_OUT) { const v = res.headers.get(h); if (v) out.set(h, v); }
  return new Response(res.body, { status: res.status, headers: out });
}
