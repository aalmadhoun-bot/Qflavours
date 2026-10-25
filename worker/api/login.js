import { fail, findUser, json, publicUser, sessionCookie } from "../auth.js";
import { record } from "../activity.js";

export async function onRequestPost({ request, env }) {
  const { email } = await request.json().catch(() => ({}));
  const user = await findUser(env, email);
  if (!user) return fail(["هذا البريد غير مسجَّل — اطلب من المدير إضافتك", "This email isn't registered — ask your admin to add you"], 401);
  await record(env, user.email, "login").catch(() => {});  // the usage log must never block a sign-in
  return json(publicUser(user), 200, { "set-cookie": await sessionCookie(env, user) });
}
