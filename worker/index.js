// Worker entry (Cloudflare Workers with static assets, see wrangler.jsonc).
// Every request runs the middleware first (login check), then the matching /api handler or the static file.
// Handlers keep the Pages Functions shape: ({ request, env, data, next }) => Response.
import { fail } from "./auth.js";
import { onRequest as middleware } from "./middleware.js";
import * as login from "./api/login.js";
import * as logout from "./api/logout.js";
import * as me from "./api/me.js";
import * as users from "./api/users.js";

const ROUTES = { "/api/login": login, "/api/logout": logout, "/api/me": me, "/api/users": users };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ctx = { request, env, data: {} };
    ctx.next = async () => {
      const mod = ROUTES[url.pathname];
      if (!mod) return url.pathname.startsWith("/api/") ? fail("غير موجود", 404) : env.ASSETS.fetch(request);
      const handler = mod["onRequest" + request.method[0] + request.method.slice(1).toLowerCase()];
      return handler ? handler(ctx) : fail("الطريقة غير مدعومة", 405);
    };
    return middleware(ctx);
  },
};
