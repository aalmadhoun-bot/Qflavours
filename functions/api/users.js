// User management (admins only): list, add or edit, delete.
import { ROLES, fail, findUser, isOwner, json, listUsers, normEmail, publicUser, saveUser, validEmail } from "../../lib/auth.js";

const notAdmin = (data) => data.user.role !== "admin" && fail("هذه العملية للمديرين فقط", 403);

export async function onRequestGet({ env, data }) {
  return notAdmin(data) || json((await listUsers(env)).map(publicUser));
}

// Same email again = edit (name and role).
export async function onRequestPost({ request, env, data }) {
  if (notAdmin(data)) return notAdmin(data);
  const body = await request.json().catch(() => ({}));
  const email = normEmail(body.email);
  const name = String(body.name || "").trim();
  const role = body.role in ROLES ? body.role : "user";
  if (!validEmail(email)) return fail("البريد الإلكتروني غير صحيح");
  if (isOwner(env, email)) return fail("حساب المالك يُدار من إعدادات Cloudflare");
  if (!name) return fail("اكتب اسم المستخدم");
  const old = await findUser(env, email);
  const user = { email, name, role, created: old?.created || new Date().toISOString() };
  await saveUser(env, user);
  return json(publicUser(user), old ? 200 : 201);
}

export async function onRequestDelete({ request, env, data }) {
  if (notAdmin(data)) return notAdmin(data);
  const email = normEmail(new URL(request.url).searchParams.get("email"));
  if (isOwner(env, email)) return fail("لا يمكن حذف حساب المالك");
  if (email === data.user.email) return fail("لا يمكنك حذف حسابك");
  if (!(await findUser(env, email))) return fail("المستخدم غير موجود", 404);
  await env.USERS.delete("user:" + email);
  return json({ ok: true });
}
