// Q-Flavours API client (browser). Port of flavours/client.py.
// Tries `Authorization: Bearer` directly first. The API's CORS policy blocks the API-TOKEN header from
// browsers, so if Bearer is refused the client switches to the site's Worker (worker/api/flavours.js),
// which forwards the same request with the key as API-TOKEN.

import { L, errorText as workerError } from "./i18n.js";

export const DEFAULT_BASE_URL = "https://qflavours-api.qoyod.com/pos/api/v2";
const PROXY_PATH = "/api/flavours";
const PRODUCT_API_VERSION = "2.5.0";   // what the Q-Flavours web app sends for products
const CATEGORY_API_VERSION = "2.8.0";  // ... and for product categories
// Defaults of the web app's "new order type" form (Settings → Order types).
const ORDER_TYPE_DEFAULTS = {
  mode: "ENTIRELY", target: "PRODUCT", method: "EXCLUSIVE", value_type: "PERCENT", value: 0,
  icon_id: null, image_url: null, is_split: false, is_digital: true, is_active: true, settings: [], products: [], methods: [],
};

export class ApiError extends Error {
  constructor(message, status = null, payload = null) { super(message); this.status = status; this.payload = payload; }
}

function errorText(payload) {
  if (typeof payload === "string") {
    return payload.trim().startsWith("<") ? L("رد غير متوقع (صفحة HTML) — تأكد من عنوان الـ API", "Unexpected reply (an HTML page) — check the API URL") : payload.slice(0, 300);
  }
  if (!payload || typeof payload !== "object") return String(payload);
  const meta = payload.meta || {};
  const parts = [];
  const msg = meta.message || payload.message;
  if (msg) parts.push(String(msg));
  const errors = payload.errors || meta.errors;
  if (errors && typeof errors === "object" && !Array.isArray(errors)) {
    for (const [f, m] of Object.entries(errors)) parts.push(`${f}: ${Array.isArray(m) ? m.join("; ") : m}`);
  }
  return parts.join(" | ") || JSON.stringify(payload).slice(0, 300);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x)); else q.append(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export class Client {
  constructor(token, baseUrl = DEFAULT_BASE_URL, { log = () => {}, delay = 150 } = {}) {
    this.token = token.trim();
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.log = log;
    this.delay = delay;
    this.viaProxy = false;
  }

  canProxy() {
    return this.baseUrl === DEFAULT_BASE_URL && typeof location !== "undefined" && /^https?:$/.test(location.protocol);
  }

  async request(method, path, opts = {}) {
    try { return await this.send(method, path, opts); }
    catch (e) {
      if (this.viaProxy || ![401, 403].includes(e.status) || !this.canProxy()) throw e;
      this.viaProxy = true;
      this.log(L("↪️ رُفض المفتاح بطريقة Bearer — إعادة المحاولة عبر خادم الموقع (API-TOKEN)", "↪️ The key was refused as Bearer — retrying through this site's server (API-TOKEN)"));
      try { return await this.send(method, path, opts); }
      catch (e2) {
        if (!e2.proxyMissing) throw e2;
        this.viaProxy = false;  // e.g. the GitHub Pages copy: no Worker behind /api
        throw e;
      }
    }
  }

  async send(method, path, { params, body, version, retries = 3 } = {}) {
    const rel = path.replace(/^\/+/, "");
    const url = (this.viaProxy ? `${PROXY_PATH}/${rel}` : path.startsWith("http") ? path : `${this.baseUrl}/${rel}`) + toQuery(params);
    const headers = { Accept: "application/json" };
    if (this.viaProxy) headers["X-Flavours-Token"] = this.token;
    else headers.Authorization = `Bearer ${this.token}`;
    if (version) headers["X-API-Version"] = version;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const credentials = this.viaProxy ? "same-origin" : "omit";
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let resp;
      try {
        resp = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials });
      } catch (e) {
        lastErr = e;
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if ([429, 502, 503, 504].includes(resp.status) && attempt < retries) {
        const wait = Number(resp.headers.get("Retry-After")) || 2 * (attempt + 1);
        this.log(L(`⏳ ${resp.status} — إعادة المحاولة بعد ${wait} ث`, `⏳ ${resp.status} — retrying in ${wait}s`));
        await sleep(wait * 1000);
        continue;
      }
      const text = await resp.text();
      let payload = text;
      try { payload = JSON.parse(text); } catch { /* keep text */ }
      if (this.viaProxy && resp.status >= 400 && !resp.headers.get("x-flavours-proxy")) {
        // The answer came from this site, not from Q-Flavours: a Worker error (e.g. session expired) or no Worker at all.
        if (payload?.error) throw new ApiError(workerError(payload), resp.status, payload);
        throw Object.assign(new ApiError(L(`لا يوجد خادم وسيط على هذا الموقع (HTTP ${resp.status})`, `This site has no relay server (HTTP ${resp.status})`), resp.status), { proxyMissing: true });
      }
      if (resp.status >= 400) throw new ApiError(`HTTP ${resp.status}: ${errorText(payload)}`, resp.status, payload);
      const code = payload?.meta?.code;
      if (typeof code === "number" && code >= 400) throw new ApiError(`API ${code}: ${errorText(payload)}`, code, payload);
      if (this.delay) await sleep(this.delay);
      return payload;
    }
    throw new ApiError(L(`تعذّر الوصول إلى الخادم (${lastErr?.message || "network"}) — تحقق من الإنترنت أو من عنوان الـ API`, `Could not reach the server (${lastErr?.message || "network"}) — check your internet or the API URL`));
  }

  async *paginate(path, params = {}, { version, perPage = 100, maxPages = 200 } = {}) {
    for (let page = 1; page <= maxPages; page++) {
      const payload = await this.request("GET", path, { params: { ...params, per_page: perPage, page }, version });
      let data = payload?.data ?? payload;
      let items = [], last = page;
      if (data && !Array.isArray(data) && Array.isArray(data.data)) { items = data.data; last = data.last_page || page; }
      else if (Array.isArray(data)) items = data;
      for (const it of items) yield it;
      if (page >= last || items.length === 0) break;
    }
  }
  async list(path, params, opts) { const out = []; for await (const x of this.paginate(path, params, opts)) out.push(x); return out; }

  // ---------------------------------------------------------------- endpoints
  async me() { const p = await this.request("GET", "me", { retries: 1 }); return p?.data ?? p; }
  static marketIdOf(me) {
    const u = me?.userable || {};
    const m = u.market || me?.market || {};
    return (typeof m === "object" ? m.id : null) || u.market_id || me?.market_id || null;
  }
  static branchIdOf(me) { const u = me?.userable || {}; return u.branch_id || me?.branch_id || null; }

  async categories(marketId, search) {
    // Q-Flavours' manage screen lists with X-API-Version 2.8.0 + filter[scope]=MANAGE; without them
    // some categories are missing. Union several styles to be safe.
    const attempts = [
      [CATEGORY_API_VERSION, { "filter[scope]": "MANAGE", "filter[market_id]": marketId }],
      [CATEGORY_API_VERSION, { "filter[scope]": "MANAGE" }],
      [null, { "filter[market_id]": marketId }],
    ];
    const found = new Map();
    for (const [version, params] of attempts) {
      try {
        const items = await this.list("product-categories", { ...params, search }, { version });
        for (const c of items) if (c && c.id !== undefined && !found.has(c.id)) found.set(c.id, c);
      } catch { /* try next style */ }
    }
    return [...found.values()];
  }

  async findCategory(nameEn, nameAr, marketId) {
    const nn = (x) => String(x ?? "").trim().toLowerCase().split(/\s+/).join(" ");
    const targets = new Set([nn(nameEn), nn(nameAr)].filter(Boolean));
    let cands = [];
    for (const q of new Set([nameEn, nameAr].filter(Boolean))) cands = cands.concat(await this.categories(marketId, q));
    try {
      const p = await this.request("GET", "product-categories/similar", { params: { name_en: nameEn, name_ar: nameAr }, version: CATEGORY_API_VERSION, retries: 0 });
      let d = p?.data ?? p; if (d && !Array.isArray(d)) d = d.data || [];
      cands = cands.concat(d || []);
    } catch { /* optional endpoint */ }
    return cands.find((c) => targets.has(nn(c.name_en)) || targets.has(nn(c.name_ar))) || null;
  }

  async createCategory(nameEn, nameAr, marketId, icon = "🍽️") {
    const body = { name_en: nameEn, name_ar: nameAr, icon, image_url: null };
    const attempts = [[CATEGORY_API_VERSION, body], [null, body], [null, { ...body, market_id: marketId }]];
    let last = null;
    for (const [version, b] of attempts) {
      try {
        const p = await this.request("POST", "product-categories", { body: b, version, retries: 1 });
        const d = p?.data ?? p;
        if (d && d.id !== undefined) return d;
        last = new ApiError(L(`رد غير متوقع عند إنشاء التصنيف: ${JSON.stringify(p).slice(0, 200)}`, `Unexpected reply when creating the category: ${JSON.stringify(p).slice(0, 200)}`));
      } catch (e) {
        last = e;
        if (e.status === 422 && /exist/i.test(e.message)) {
          const ex = await this.findCategory(nameEn, nameAr, marketId);
          if (ex) return { ...ex, _existing: true };
          break;
        }
        if (e.status === 401 || e.status === 403) break;
      }
    }
    throw last || new ApiError(L("فشل إنشاء التصنيف", "Could not create the category"));
  }

  // Every order type Flavours knows (delivery apps, dine-in, …). `adopted` = registered in this account
  // (Settings → Order types), which is what the web app lists with filter[is_adopted]=1.
  // Returns null when the API gives no adoption info, so callers fall back to legacyOrderTypes().
  async orderTypeCatalog() {
    const items = (await this.list("orders/types", { "includes[]": ["config"] })).filter((it) => it && it.key);
    if (!items.some((it) => "is_adopted" in it || "config" in it)) return null;
    return items.map((it) => ({
      key: it.key, name_en: it.name_en ?? null, name_ar: it.name_ar ?? null,
      adopted: !!(it.is_adopted ?? it.config), active: !!it.config?.is_active, config_id: it.config?.id ?? null,
    }));
  }

  // Registers an order type in the account: { type_key } adopts a known one, { name_en, name_ar } creates a custom one.
  // Same defaults as the web app's "new order type" form. Resolves with the type key when the API returns it.
  async createOrderType({ type_key = null, name_en = "", name_ar = null }) {
    const body = { ...ORDER_TYPE_DEFAULTS, type_key, name_en, name_ar };
    const p = await this.request("POST", "orders/types/configs", { body, retries: 1 });
    const d = p?.data ?? p;
    return d?.type_key || d?.type?.key || d?.key || type_key || null;
  }

  async orderTypes() {
    try {
      const all = await this.orderTypeCatalog();
      if (all) return all.filter((t) => t.adopted);
    } catch { /* older API: fall back */ }
    return this.legacyOrderTypes();
  }

  async legacyOrderTypes() {
    for (const path of ["orders/types", "orders/types/configs"]) {
      let p;
      try { p = await this.request("GET", path, { retries: 1 }); } catch { continue; }
      let d = p?.data ?? p;
      if (d && !Array.isArray(d)) d = d.data || d.types || Object.values(d);
      const items = [];
      for (const it of Array.isArray(d) ? d : []) {
        if (typeof it === "string") items.push({ key: it, name_en: it, name_ar: null });
        else if (it && typeof it === "object") {
          const key = it.key || it.type_key || (typeof it.type === "string" ? it.type : null);
          if (key) items.push({ key, name_en: it.name_en || it.name || null, name_ar: it.name_ar || null });
        }
      }
      if (items.length) return items;
    }
    return [];
  }

  async products(marketId, includes) {
    const params = { "filter[market_id]": marketId };
    if (includes) params["includes[]"] = includes;
    return this.list("products", params);
  }

  async ingredients(marketId) {
    try {
      const items = await this.list("ingredients", { "filter[market_id]": marketId });
      const out = items.map(normIngredient).filter(Boolean);
      if (out.length) return out;
    } catch { /* fall back to harvesting */ }
    const found = new Map();
    for (const inc of [["options.ingredients.ingredient"], ["modifiers.ingredients"]]) {
      try { (await this.products(marketId, inc)).forEach((p) => harvest(p, found)); } catch { /* ignore */ }
      if (found.size) break;
    }
    return [...found.values()];
  }

  createProduct(body) { return this.request("POST", "products", { body, version: PRODUCT_API_VERSION, retries: 1 }).then((p) => p?.data ?? p); }
  updateProduct(id, body) { return this.request("POST", `products/${id}`, { body, version: PRODUCT_API_VERSION, retries: 1 }).then((p) => p?.data ?? p); }
  deleteProduct(id) { return this.request("DELETE", `products/${id}`, { version: PRODUCT_API_VERSION, retries: 1 }); }
}

function normIngredient(o) {
  if (!o || typeof o !== "object") return null;
  const id = o.id ?? o.ingredient_id;
  const name_en = o.name_en || o.name, name_ar = o.name_ar;
  if (id === undefined || id === null || !(name_en || name_ar)) return null;
  let unit = o.recipe_unit || o.target_unit || o.unit || null;
  if (unit && typeof unit === "object") unit = unit.name_en || unit.name || unit.key;
  return { id, name_en: name_en || null, name_ar: name_ar || null, unit };
}
function harvest(node, found) {
  if (Array.isArray(node)) { node.forEach((x) => harvest(x, found)); return; }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (k === "ingredient" && v && typeof v === "object") { const n = normIngredient(v); if (n) found.set(n.id, n); }
    harvest(v, found);
  }
}
