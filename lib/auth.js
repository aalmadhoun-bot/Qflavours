// Shared helpers for the Cloudflare Pages Functions in functions/ (site login and users).
// Login is by email only for now: any email on the list gets in (password login is in commit b2af000).
// Users live in the KV namespace bound as USERS under "user:<email>".
// The owner account comes from the ADMIN_EMAIL secret and is never stored in KV.
// Sessions are a signed cookie (HMAC with SESSION_SECRET); deleting a user ends their sessions.

const enc = new TextEncoder();
export const COOKIE = "qf_session";
const SESSION_HOURS = 12;
export const ROLES = { user: "مستخدم", admin: "مدير" };

export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});
export const fail = (error, status = 400) => json({ error }, status);

export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function sameText(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export const configError = (env) =>
  !env.USERS ? "لم يُربط مخزن KV باسم USERS" :
  !env.SESSION_SECRET ? "المتغير SESSION_SECRET غير مضبوط" :
  !env.ADMIN_EMAIL ? "المتغير ADMIN_EMAIL غير مضبوط" : "";

const ownerUser = (env) => ({ email: normEmail(env.ADMIN_EMAIL), name: "المالك", role: "admin", owner: true });
export const isOwner = (env, email) => normEmail(email) === normEmail(env.ADMIN_EMAIL);

export async function findUser(env, email) {
  email = normEmail(email);
  if (!email) return null;
  if (isOwner(env, email)) return ownerUser(env);
  return env.USERS.get("user:" + email, "json");
}

export async function listUsers(env) {
  const users = [ownerUser(env)];
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: "user:", cursor });
    for (const k of page.keys) { const u = await env.USERS.get(k.name, "json"); if (u) users.push(u); }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return users;
}

export const saveUser = (env, user) => env.USERS.put("user:" + user.email, JSON.stringify(user));
export const publicUser = ({ email, name, role, owner = false, created = null }) => ({ email, name, role, owner, created });

export async function sessionCookie(env, user) {
  const payload = b64u(enc.encode(JSON.stringify({ e: user.email, x: Date.now() + SESSION_HOURS * 3600e3 })));
  return `${COOKIE}=${payload}.${await hmac(env.SESSION_SECRET, payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`;
}
export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function sessionUser(request, env) {
  const raw = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !sig || !sameText(sig, await hmac(env.SESSION_SECRET, payload))) return null;
  let s;
  try { s = JSON.parse(new TextDecoder().decode(unb64u(payload))); } catch { return null; }
  if (!(s.x > Date.now())) return null;
  return findUser(env, s.e);
}
