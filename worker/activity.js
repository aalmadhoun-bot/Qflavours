// Usage log for the admin report. One KV entry per event in the USERS namespace, keyed "act:<ISO time>:<random>"
// so keys sort by time; the event itself rides in the key's metadata (≤ 1024 bytes), so a listing returns
// everything without a read per event. Entries expire on their own after RETENTION_DAYS.
export const RETENTION_DAYS = 180;
const PREFIX = "act:";

// What a page may report, and the numeric fields each event may carry. "login" is recorded by the server only.
export const ACTIONS = {
  login: [],
  connect: [],
  dry_run: ["ready", "errors", "warnings"],
  upload: ["ready", "ok", "failed", "errors"],
  delete: ["total", "deleted", "failed"],
  clear_recipe: ["total", "cleared", "failed"],
  template: [],
  reference: [],
  report: [],
  backup: ["products"],
  delete_report: [],
};
const CLIENT_ACTIONS = new Set(Object.keys(ACTIONS).filter((a) => a !== "login"));
export const isClientAction = (a) => CLIENT_ACTIONS.has(a);

const short = (v, n = 40) => (v === null || v === undefined || v === "" ? undefined : String(v).slice(0, n));
const count = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Math.trunc(Number(v)), 1e6) : undefined);

// Keep only known, small fields: the email always comes from the session, never from the page.
export function cleanEvent(email, action, input = {}) {
  const ev = { e: email, a: action, t: Date.now() };
  const market = short(input.market);
  if (market) ev.m = market;
  const page = short(input.page, 12);
  if (page) ev.p = page;
  const kind = short(input.kind, 12);  // what a delete/backup worked on: products | ingredients | recipes
  if (kind) ev.k = kind;
  for (const f of ACTIONS[action] || []) { const c = count(input[f]); if (c !== undefined) ev[f] = c; }
  return ev;
}

export async function record(env, email, action, input) {
  const ev = cleanEvent(email, action, input);
  const key = `${PREFIX}${new Date(ev.t).toISOString()}:${crypto.randomUUID().slice(0, 8)}`;
  await env.USERS.put(key, "", { metadata: ev, expirationTtl: RETENTION_DAYS * 86400 });
  return ev;
}

// Events between from and to (ms timestamps, inclusive), oldest first.
export async function listEvents(env, from = 0, to = Date.now()) {
  const out = [];
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) {
      const ev = k.metadata;
      if (ev && ev.t >= from && ev.t <= to) out.push(ev);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out.sort((a, b) => a.t - b.t);
}
