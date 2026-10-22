// Read the filled template and write report / reference workbooks (uses ExcelJS, loaded globally).
const SHEETS = ["Products", "Modifiers", "Recipes", "Delivery_Prices", "Price_Rules", "Ingredients_Map"];

const X = () => globalThis.ExcelJS;

function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("result" in v) return cellValue(v.result);                       // formula
    if (Array.isArray(v.richText)) return cellValue(v.richText.map((t) => t.text).join(""));
    if ("text" in v) return cellValue(v.text);                           // hyperlink
    if ("error" in v) return null;
    return String(v);
  }
  if (typeof v === "string") { const s = v.trim(); return s === "" ? null : s; }
  return v;
}

// Reading uses SheetJS (tolerant of files written by openpyxl/Excel/Google Sheets);
// writing uses ExcelJS (styled headers).
export async function readWorkbook(arrayBuffer) {
  const wb = globalThis.XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const out = {};
  for (const name of SHEETS) {
    out[name] = [];
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const rows = globalThis.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    if (!rows.length) continue;
    const headers = rows[0].map((h) => { const v = cellValue(h); return v === null ? null : String(v).trim(); });
    rows.slice(1).forEach((r, i) => {
      const rec = {};
      headers.forEach((h, c) => { if (h) rec[h] = cellValue(r[c]); });
      if (Object.values(rec).every((v) => v === null)) return;
      rec._row = i + 2;
      out[name].push(rec);
    });
  }
  return out;
}

export async function writeWorkbook(sheets) {
  const wb = new (X().Workbook)();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name.slice(0, 31));
    if (!rows.length) { ws.addRow(["(لا توجد بيانات)"]); continue; }
    const keys = [];
    rows.forEach((r) => Object.keys(r).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    ws.columns = keys.map((k) => ({ header: k, key: k, width: 24 }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }; });
    for (const r of rows) {
      const flat = {};
      for (const k of keys) { const v = r[k]; flat[k] = v !== null && typeof v === "object" ? JSON.stringify(v).slice(0, 32000) : v; }
      ws.addRow(flat);
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return wb.xlsx.writeBuffer();
}
