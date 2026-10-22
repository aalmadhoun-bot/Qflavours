// Q-Flavours API client (browser). Port of flavours/client.py.
// Only `Authorization: Bearer` is used: the API's CORS policy blocks the API-TOKEN header from other sites.

export const DEFAULT_BASE_URL = "https://qflavours-api.qoyod.com/pos/api/v2";
const PRODUCT_API_VERSION = "2.5.0";   // what the Q-Flavours web app sends for products
const CATEGORY_API_VERSION = "2.8.0";  // ... and for product categories

export class ApiError extends Error {
  constructor(message, status = null, payload = null) { super(message); this.status = status; this.payload = payload; }
}

function errorText(payload) {
  if (typeof payload === "string") {
    return payload.trim().startsWith("<") ? "رد غير متوقع (صفحة HTML) — تأكد من عنوان الـ API" : payload.slice(0, 300);
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
  }

  async request(method, path, { params, body, version, retries = 3 } = {}) {
    const url = (path.startsWith("http") ? path : `${this.baseUrl}/${path.replace(/^\/+/, "")}`) + toQuery(params);
    const headers = { Accept: "application/json", Authorization: `Bearer ${this.token}` };
    if (version) headers["X-API-Version"] = version;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let resp;
      try {
        resp = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit" });
      } catch (e) {
        lastErr = e;
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if ([429, 502, 503, 504].includes(resp.status) && attempt < retries) {
        const wait = Number(resp.headers.get("Retry-After")) || 2 * (attempt + 1);
        this.log(`⏳ ${resp.status} — إعادة المحاولة بعد ${wait} ث`);
        await sleep(wait * 1000);
        continue;
      }
      const text = await resp.text();
      let payload = text;
      try { payload = JSON.parse(text); } catch { /* keep text */ }
      if (resp.status >= 400) throw new ApiError(`HTTP ${resp.status}: ${errorText(payload)}`, resp.status, payload);
      const code = payload?.meta?.code;
      if (typeof code === "number" && code >= 400) throw new ApiError(`API ${code}: ${errorText(payload)}`, code, payload);
      if (this.delay) await sleep(this.delay);
      return payload;
    }
    throw new ApiError(`تعذّر الوصول إلى الخادم (${lastErr?.message || "network"}) — تحقق من الإنترنت أو من عنوان الـ API`);
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
        last = new ApiError(`رد غير متوقع عند إنشاء التصنيف: ${JSON.stringify(p).slice(0, 200)}`);
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
    throw last || new ApiError("فشل إنشاء التصنيف");
  }

  async orderTypes() {
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
