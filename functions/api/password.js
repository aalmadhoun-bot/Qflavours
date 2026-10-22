// The signed-in user changes their own password. The owner's password is the ADMIN_PASSWORD secret.
import { checkPassword, fail, hashPassword, json, saveUser, sessionCookie } from "../../lib/auth.js";

export async function onRequestPost({ request, env, data }) {
  const user = data.user;
  if (user.owner) return fail("كلمة مرور المالك تُغيَّر من متغير ADMIN_PASSWORD في Cloudflare");
  const { current, password } = await request.json().catch(() => ({}));
  if (!(await checkPassword(env, user, String(current || "")))) return fail("كلمة المرور الحالية غير صحيحة");
  if (String(password || "").length < 8) return fail("كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل");
  const next = { ...user, ...(await hashPassword(String(password))), pv: (user.pv || 0) + 1 };
  await saveUser(env, next);
  return json({ ok: true }, 200, { "set-cookie": await sessionCookie(env, next) });
}
