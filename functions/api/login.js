import { fail, findUser, json, publicUser, sessionCookie } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  const { email } = await request.json().catch(() => ({}));
  const user = await findUser(env, email);
  if (!user) return fail("هذا البريد غير مسجَّل — اطلب من المدير إضافتك", 401);
  return json(publicUser(user), 200, { "set-cookie": await sessionCookie(env, user) });
}
