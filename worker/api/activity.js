// Usage log: any signed-in user reports what they did (POST); admins read the log for the report (GET).
import { fail, json, listUsers, publicUser } from "../auth.js";
import { RETENTION_DAYS, isClientAction, listEvents, record } from "../activity.js";

export async function onRequestPost({ request, env, data }) {
  const body = await request.json().catch(() => ({}));
  if (!isClientAction(body.action)) return fail(["نوع نشاط غير معروف", "Unknown activity type"]);
  await record(env, data.user.email, body.action, body);
  return json({ ok: true });
}

// ?from=<ms>&to=<ms> (defaults: the whole retention period). Returns the events and the users to name them.
export async function onRequestGet({ request, env, data }) {
  if (data.user.role !== "admin") return fail(["هذه العملية للمديرين فقط", "Admins only"], 403);
  const q = new URL(request.url).searchParams;
  const now = Date.now();
  const from = Number(q.get("from")) || now - RETENTION_DAYS * 86400e3;
  const to = Number(q.get("to")) || now;
  const [events, users] = await Promise.all([listEvents(env, from, to), listUsers(env)]);
  return json({ from, to, retention_days: RETENTION_DAYS, events, users: users.map(publicUser) });
}
