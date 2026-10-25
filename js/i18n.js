// Interface language: Arabic (default, RTL) or English (LTR).
// - Markup is written in Arabic; an element's English goes in data-en (its innerHTML), data-en-ph (placeholder)
//   or data-en-title (title). Put data-en only on elements whose content has no ids or listeners inside.
// - Code picks a message with L("عربي", "English").
// - Switching applies in place (no reload, so the Flavours connection survives) and fires a "langchange"
//   event on window so pages re-render what they built in code. The choice is a per-browser preference.
// Safe to import outside a browser (the uploader/builder tests run in Node): there it stays Arabic.
const KEY = "qf_lang";
const inBrowser = typeof document !== "undefined";
const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export let lang = inBrowser && stored() === "en" ? "en" : "ar";
export const L = (ar, en) => (lang === "en" ? en : ar);
// Worker errors carry both languages: { error, error_en }.
export const errorText = (data, fallback) => L(data?.error, data?.error_en || data?.error) || fallback;

export function applyLang(root = document) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
  for (const el of root.querySelectorAll("[data-en]")) {
    if (el.dataset.ar === undefined) el.dataset.ar = el.innerHTML;
    el.innerHTML = lang === "en" ? el.dataset.en : el.dataset.ar;
  }
  for (const el of root.querySelectorAll("[data-en-ph]")) {
    if (el.dataset.arPh === undefined) el.dataset.arPh = el.placeholder;
    el.placeholder = lang === "en" ? el.dataset.enPh : el.dataset.arPh;
  }
  for (const el of root.querySelectorAll("[data-en-title]")) {
    if (el.dataset.arTitle === undefined) el.dataset.arTitle = el.title;
    el.title = lang === "en" ? el.dataset.enTitle : el.dataset.arTitle;
  }
  for (const el of root.querySelectorAll("[data-lang-toggle]")) el.textContent = L("English", "العربية");
}

export function setLang(next) {
  lang = next === "en" ? "en" : "ar";
  try { localStorage.setItem(KEY, lang); } catch { /* storage blocked: applies to this page only */ }
  applyLang();
  dispatchEvent(new CustomEvent("langchange"));
}

// A switch button; any element with data-lang-toggle works.
export const langButton = (cls = "lang-btn sm") => `<button type="button" class="${cls}" data-lang-toggle>${L("English", "العربية")}</button>`;

if (inBrowser) {
  applyLang();
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-lang-toggle]")) setLang(lang === "en" ? "ar" : "en");
  });
}
