import { checkPassword, fail, findUser, json, publicUser, sessionCookie } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  const { email, password } = await request.json().catch(() => ({}));
  const user = await findUser(env, email);
  if (!user || !password || !(await checkPassword(env, user, String(password)))) return fail("البريد أو كلمة المرور غير صحيحة", 401);
  return json(publicUser(user), 200, { "set-cookie": await sessionCookie(env, user) });
}
