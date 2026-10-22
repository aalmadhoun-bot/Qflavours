// Shared helpers for the Cloudflare Pages Functions in functions/ (site login and users).
// Users live in the KV namespace bound as USERS under "user:<email>".
// The owner account comes from the ADMIN_EMAIL / ADMIN_PASSWORD secrets and is never stored in KV.
// Sessions are a signed cookie (HMAC with SESSION_SECRET); "pv" bumps on password change to end old sessions.

const enc = new TextEncoder();
export const COOKIE = "qf_session";
const SESSION_HOURS = 12;
const PBKDF2_ITERATIONS = 100000;  // the Workers runtime caps PBKDF2 at 100k
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

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { salt: b64u(salt), hash: b64u(bits) };
}

export async function checkPassword(env, user, password) {
  if (user.owner) return sameText(await hmac(env.SESSION_SECRET, password), await hmac(env.SESSION_SECRET, env.ADMIN_PASSWORD));
  return sameText((await hashPassword(password, unb64u(user.salt))).hash, user.hash);
}

export const configError = (env) =>
  !env.USERS ? "لم يُربط مخزن KV باسم USERS" :
  !env.SESSION_SECRET ? "المتغير SESSION_SECRET غير مضبوط" :
  !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD ? "المتغيران ADMIN_EMAIL و ADMIN_PASSWORD غير مضبوطين" : "";

const ownerUser = (env) => ({ email: normEmail(env.ADMIN_EMAIL), name: "المالك", role: "admin", owner: true, pv: 0 });
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
  const payload = b64u(enc.encode(JSON.stringify({ e: user.email, v: user.pv || 0, x: Date.now() + SESSION_HOURS * 3600e3 })));
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
  const user = await findUser(env, s.e);
  return user && (user.pv || 0) === s.v ? user : null;
}
