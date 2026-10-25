// User management (admins only): list, add or edit, delete.
import { ROLES, fail, findUser, isOwner, json, listUsers, normEmail, publicUser, saveUser, validEmail } from "../auth.js";

const notAdmin = (data) => data.user.role !== "admin" && fail(["هذه العملية للمديرين فقط", "Admins only"], 403);

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
  if (!validEmail(email)) return fail(["البريد الإلكتروني غير صحيح", "Invalid email address"]);
  if (isOwner(env, email)) return fail(["حساب المالك يُدار من إعدادات Cloudflare", "The owner account is managed in Cloudflare settings"]);
  if (!name) return fail(["اكتب اسم المستخدم", "Enter the user's name"]);
  const old = await findUser(env, email);
  const user = { email, name, role, created: old?.created || new Date().toISOString() };
  await saveUser(env, user);
  return json(publicUser(user), old ? 200 : 201);
}

export async function onRequestDelete({ request, env, data }) {
  if (notAdmin(data)) return notAdmin(data);
  const email = normEmail(new URL(request.url).searchParams.get("email"));
  if (isOwner(env, email)) return fail(["لا يمكن حذف حساب المالك", "The owner account can't be deleted"]);
  if (email === data.user.email) return fail(["لا يمكنك حذف حسابك", "You can't delete your own account"]);
  if (!(await findUser(env, email))) return fail(["المستخدم غير موجود", "User not found"], 404);
  await env.USERS.delete("user:" + email);
  return json({ ok: true });
}
