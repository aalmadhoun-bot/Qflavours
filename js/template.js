// Upload template for the connected account: the stock empty template's sheets, instructions and header notes,
// plus a price column per registered order type after `price` in Products / Modifiers, and the same types as
// the Delivery_Prices columns and Price_Rules keys.
// Built fresh with ExcelJS because ExcelJS can't load the stock file (its header comments break its reader);
// SheetJS reads the stock file.
const SOURCE = "templates/flavours_template_empty.xlsx";
const FIXED_PRICE_COLS = ["product_code", "modifier_name_en"];
const INSTRUCTIONS = "تعليمات";

function styleHeader(ws) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function addTable(wb, name, header, notes = {}, rows = []) {
  const ws = wb.addWorksheet(name);
  ws.columns = header.map((h) => ({ header: h, key: h, width: Math.max(14, String(h).length + 4) }));
  header.forEach((h, i) => { if (notes[h]) ws.getRow(1).getCell(i + 1).note = notes[h]; });
  for (const r of rows) ws.addRow(r);
  styleHeader(ws);
  return ws;
}

export async function accountTemplate(ctx) {
  const XLSX = globalThis.XLSX;
  const src = XLSX.read(await (await fetch(SOURCE)).arrayBuffer());
  const types = ctx.orderTypes.filter((t) => t.key && t.active !== false);  // legacy lists carry no status: keep all
  const typeName = (t) => t.name_ar || t.name_en || t.key;
  const wb = new globalThis.ExcelJS.Workbook();

  for (const name of src.SheetNames) {
    const ws = src.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (name === INSTRUCTIONS) {
      const out = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
      out.getColumn(1).width = 120;
      rows.forEach((r) => out.addRow([r[0] ?? ""]));
      out.addRow([""]);
      out.addRow([`هذا القالب خاص بحساب Market ${ctx.marketId ?? "-"} (صُدّر ${new Date().toLocaleDateString("ar-SA-u-nu-latn")}).`]).font = { bold: true };
      out.addRow(["أسعار التطبيقات: بعد عمود price في ورقتي Products و Modifiers يوجد عمود لكل تطبيق مسجّل في هذا الحساب — اكتب فيه سعر المنتج أو الخيار/الإضافة في ذلك التطبيق في نفس السطر."]);
      out.addRow(["نفس التطبيقات هي أعمدة ورقة Delivery_Prices (اختيارية) ومفاتيح Price_Rules، وقائمتها كاملة في ورقة Order_Types."]);
      out.addRow(["لإضافة تطبيق غير مسجّل أضف عموداً باسمه (مثل HUNGERSTATION)؛ ستفعّله الأداة أو تنشئه في حسابك عند الرفع الفعلي."]);
      out.getRow(1).font = { bold: true, size: 13 };
      continue;
    }
    const header = (rows[0] || []).filter((h) => h !== null).map(String);
    const notes = {};
    header.forEach((h, i) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: i })];
      if (cell?.c?.length) notes[h] = cell.c.map((x) => x.t).join("\n");
    });
    if (name === "Products" || name === "Modifiers") {
      // one column per app right after `price`: that row's price in that app
      const at = header.indexOf("price") + 1 || header.length;
      const cols = [...header.slice(0, at), ...types.map((t) => t.key), ...header.slice(at)];
      for (const t of types) {
        notes[t.key] = name === "Products"
          ? `سعر المنتج في ${typeName(t)} (للمنتج بسعر واحد، أو لكل خياراته إن كان له خيارات) — فارغ = يُحسب من Price_Rules أو يبقى السعر الأساسي`
          : `سعر هذا الخيار/الإضافة في ${typeName(t)} — فارغ = يُحسب من Price_Rules أو يبقى سعره الأساسي`;
      }
      addTable(wb, name, cols, notes);
    } else if (name === "Delivery_Prices") {
      const cols = [...FIXED_PRICE_COLS, ...types.map((t) => t.key)];
      for (const t of types) notes[t.key] = `سعر الخيار عند الطلب عبر ${typeName(t)} — فارغ = يُحسب من Price_Rules أو يبقى السعر الأساسي (اختياري: يمكنك كتابة أسعار التطبيقات مباشرة في Products / Modifiers)`;
      addTable(wb, name, cols, notes);
    } else if (name === "Price_Rules") {
      addTable(wb, name, header, notes, types.map((t) => ({ payment_method_key: t.key })));
    } else {
      addTable(wb, name, header, notes);
    }
  }

  const status = (t) => (t.active === false ? "معطّل" : t.adopted === false ? "غير مسجّل" : "مفعّل");
  const listed = ctx.orderTypes.filter((t) => t.key);
  const ws = addTable(wb, "Order_Types", ["المفتاح (key)", "الاسم بالعربي", "الاسم بالإنجليزي", "الحالة", "عمود في القالب"], {
    "المفتاح (key)": "اكتب هذا المفتاح (أو الاسم) كعنوان عمود في Delivery_Prices أو في payment_method_key في Price_Rules",
  }, listed.map((t) => ({
    "المفتاح (key)": t.key, "الاسم بالعربي": t.name_ar, "الاسم بالإنجليزي": t.name_en, "الحالة": status(t),
    "عمود في القالب": types.includes(t) ? "نعم" : "لا",
  })));
  ws.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];
  ws.columns.forEach((c) => { c.width = 24; });
  return wb.xlsx.writeBuffer();
}
