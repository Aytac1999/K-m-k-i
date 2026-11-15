// pdf.js mətnini "pdftotext -layout" üslubunda sətirlərə çevirir (sütun boşluqları saxlanılır).
export const CFG = { pitch: 5.0, col: 4.2 }; // sətir və sütun şəbəkəsi (pt)

export function itemsToText(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4], y = it.transform[5], fs = Math.abs(it.transform[3]) || 8;
    const key = Math.round(y / CFG.pitch);
    let row = rows.find((r) => r.key === key);
    if (!row) rows.push((row = { key, y: key * CFG.pitch, items: [] }));
    row.items.push({ x, w: it.width, s: it.str, fs });
  }
  rows.sort((a, b) => b.y - a.y);
  const lines = [];
  for (const row of rows) {
    // üst-üstə düşən mətnləri ayrı alt-sətirlərə böl
    row.items.sort((a, b) => a.x - b.x);
    const subs = [];
    for (const it of row.items) {
      let sub = subs.find((s) => it.x >= s.end - 0.6);
      if (!sub) subs.push((sub = { end: -1e9, items: [] }));
      sub.items.push(it);
      sub.end = it.x + it.w;
    }
    for (const r of subs) {
    let line = "", endX = null;
    for (const it of r.items) {
      if (endX === null) {
        line = " ".repeat(Math.max(0, Math.round(it.x / CFG.col)));
      } else {
        const gap = it.x - endX;
        const sp = gap < it.fs * 0.15 ? 0 : Math.max(1, Math.round(gap / CFG.col));
        line += " ".repeat(sp);
      }
      line += it.s;
      endX = it.x + it.w;
    }
    lines.push(line.replace(/\s+$/, ""));
    }
  }
  return lines.join("\n");
}

export async function pdfPages(pdfjs, bytes) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true, verbosity: 0, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(itemsToText(tc.items));
  }
  try { await doc.cleanup(); } catch (_) {}
  return out;
}
