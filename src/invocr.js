// Skan edilmiş invoysdan (şəkil) cədvəli oxuyur: cədvəl xətləri tapılır, hər xana ayrıca OCR olunur.
export function gridOf(canvas) {
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext("2d").getImageData(0, 0, W, H).data;
  const dark = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) dark[p] = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) < 150 ? 1 : 0;
  // ən uzun fasiləsiz (kiçik boşluqlara dözümlü) qara parça
  const runRow = (y, x0 = 0, x1 = W) => { let best = 0, cur = 0, gap = 0, bs = 0, s = 0, be = 0; for (let x = x0; x < x1; x++) { if (dark[y * W + x]) { if (!cur) s = x; cur += 1 + gap; gap = 0; if (cur > best) { best = cur; bs = s; be = x; } } else if (cur && ++gap > 6) { cur = 0; gap = 0; } } return [best, bs, be]; };
  const hl = [];
  for (let y = 0; y < H; y++) { const [len, a, b] = runRow(y); if (len > W * 0.45) hl.push({ y, a, b }); }
  // yaxın sətirləri birləşdir
  const ys = []; for (const l of hl) { const last = ys[ys.length - 1]; if (last && l.y - last.y1 <= 6) { last.y1 = l.y; last.a = Math.min(last.a, l.a); last.b = Math.max(last.b, l.b); } else ys.push({ y0: l.y, y1: l.y, a: l.a, b: l.b }); }
  if (ys.length < 4) return null;
  const all = ys.slice();
  // cədvəl: ən bərabər aralıqlı xətt qrupu (digər qrupları – çərçivələr, imza xətləri – atırıq)
  const groups = []; let cur = [ys[0]];
  for (let i = 1; i < ys.length; i++) { if (ys[i].y0 - ys[i - 1].y1 > 90) { groups.push(cur); cur = []; } cur.push(ys[i]); }
  groups.push(cur);
  const score = (g) => { if (g.length < 5) return 0; const gaps = g.slice(1).map((l, i) => l.y0 - g[i].y1).sort((a, b) => a - b); const med = gaps[gaps.length >> 1]; return gaps.filter((x) => Math.abs(x - med) <= med * 0.2).length; };
  groups.sort((a, b) => score(b) - score(a));
  const tg = groups[0]; if (score(tg) < 4) return null;
  const above = all.filter((l) => l.y1 < tg[0].y0 - 5).pop();
  ys.length = 0; ys.push(...tg);
  const x0 = Math.min(...ys.map((l) => l.a)), x1 = Math.max(...ys.map((l) => l.b));
  const top = ys[0].y1, bot = ys[ys.length - 1].y0;
  // şaquli xətlər: cədvəlin aşağı hissəsində (başlıq birləşmiş xanalar ola bilər)
  const r0 = Math.round(top + (bot - top) * 0.4), r1 = Math.round(bot - (bot - top) * 0.1);
  const vx = [];
  for (let x = x0 - 4; x <= x1 + 4; x++) { let c = 0; for (let y = r0; y < r1; y++) if (dark[y * W + x] || dark[y * W + x + 1] || (x > 0 && dark[y * W + x - 1])) c++; if (c > (r1 - r0) * 0.85) vx.push(x); }
  const xs = []; for (const x of vx) { const l = xs[xs.length - 1]; if (l && x - l.x1 <= 4) l.x1 = x; else xs.push({ x0: x, x1: x }); }
  return { ys, xs, x0, x1, top, bot, hdr: [above ? above.y1 : Math.max(0, ys[0].y0 - 180), ys[0].y0] };
}

const crop = (src, x0, y0, x1, y1, scale = 1) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round((x1 - x0) * scale)); c.height = Math.max(1, Math.round((y1 - y0) * scale)); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height); return c; };
const num = (s) => { s = String(s || "").replace(/\s/g, "").replace(/[Oо]/g, "0").replace(/[,.]+$/, ""); const m = /^-?\d{1,3}(?:[\s.]\d{3})*(?:[.,]\d+)?$|^-?\d+(?:[.,]\d+)?$/.exec(s); if (!m) return null; let t = s; if (/,\d{1,3}$/.test(t) && /\./.test(t)) t = t.replace(/\./g, "").replace(",", "."); else t = t.replace(",", "."); const v = parseFloat(t); return isNaN(v) ? null : v; };
export async function readTable(canvas, worker) {
  const g = gridOf(canvas); if (!g) return null;
  const cols = []; for (let i = 0; i + 1 < g.xs.length; i++) cols.push([g.xs[i].x1 + 2, g.xs[i + 1].x0 - 1]);
  // başlıq
  await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
  const hr = await worker.recognize(crop(canvas, g.x0, g.hdr[0] + 3, g.x1, g.hdr[1] - 2), {}, { blocks: true });
  const words = []; for (const b of hr.data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ t: w.text, cx: g.x0 + (w.bbox.x0 + w.bbox.x1) / 2 });
  const head = cols.map(([a, b]) => words.filter((w) => w.cx >= a && w.cx <= b).map((w) => w.t).join(" "));
  const find = (re, not) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const n = cols.length;
  let iTotal = find(/стоим|amount|total|сумм|value/i); if (iTotal < 0) iTotal = n - 1;
  let iPrice = find(/цена|price/i); if (iPrice < 0) iPrice = n - 2;
  let iPcs = find(/шт|pcs|pieces/i); 
  let iQty = find(/м3|м³|m3|кол|qty|quant|volume/i, /шт|pcs/i); if (iQty < 0 || iQty === iPcs) iQty = n - 3;
  let iName = find(/наимен|descr|goods|name|товар/i);
  // sətirlər: hündürlüyü median olanlar (başlıq/yekun çıxılır)
  const lines = g.ys, rows = [];
  for (let i = 0; i + 1 < lines.length; i++) rows.push([lines[i].y1 + 2, lines[i + 1].y0 - 1]);
  const hs = rows.map((r) => r[1] - r[0]).sort((a, b) => a - b), med = hs[hs.length >> 1];
  const body = rows.filter((r) => Math.abs(r[1] - r[0] - med) <= med * 0.35);
  const out = [];
  const cell = async (ci, r, numeric) => {
    const c = crop(canvas, cols[ci][0] + 3, r[0] + 3, cols[ci][1] - 3, r[1] - 3, 2);
    await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: numeric ? "0123456789,." : "" });
    return ((await worker.recognize(c)).data.text || "").trim();
  };
  const nameIdx = iName >= 0 ? [iName] : [];
  if (!nameIdx.length) { const last = iPcs >= 0 ? iPcs - 4 : iQty - 5; for (let i = 1; i <= Math.max(1, last); i++) nameIdx.push(i); }
  for (const r of body) {
    const row = { name: [], qty: null, price: null, total: null, pcs: null };
    for (const i of nameIdx) row.name.push(await cell(i, r, false));
    row.pcs = iPcs >= 0 ? num(await cell(iPcs, r, true)) : null;
    row.qty = num(await cell(iQty, r, true)); row.price = num(await cell(iPrice, r, true)); row.total = num(await cell(iTotal, r, true));
    out.push(row);
  }
  return { head, rows: out, idx: { iName, iPcs, iQty, iPrice, iTotal } };
}

// ---------- bütöv invoys: PDF -> {no, tarix, mal sətirləri} ----------
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const dmyFix = (s) => { const m = /(\d{2})[.\/-](\d{2})[.\/-](\d{4})/.exec(s || ""); return m ? `${m[1]}.${m[2]}.${m[3]}` : ""; };
export async function renderPage(pdfjs, doc, n, targetW = 2480) {
  const page = await doc.getPage(n); const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: targetW / v1.width });
  const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  return c;
}
export async function readInvoice(pdfjs, bytes, worker, progress = () => {}) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  for (let n = 1; n <= Math.min(doc.numPages, 6); n++) {
    progress(`səhifə ${n}/${doc.numPages}`);
    const canvas = await renderPage(pdfjs, doc, n);
    await worker.setParameters({ tessedit_pageseg_mode: "6", tessedit_char_whitelist: "" });
    const text = (await worker.recognize(canvas)).data.text || "";
    if (!/сч[её]т[\s-]*фактур|инвойс|invoice|faktura|фактур/i.test(text.split("\n").slice(0, 12).join(" "))) continue;
    const hm = /(?:сч[её]т[\s-]*фактур[а-яё]*|инвойс|invoice)\s*(?:№|N[oо°]?\.?|#)?\s*([A-Za-zА-Яа-я0-9\/\-]{2,})\s*(?:от|dated|date|from|of)?\s*(\d{2}[.\/-]\d{2}[.\/-]\d{4})/i.exec(text.replace(/\n/g, " "));
    const lines = text.split("\n").map((s) => s.trim());
    const pi = lines.findIndex((l) => /наименование\s+продукции|наименование\s+товара|description/i.test(l));
    let product = ""; if (pi >= 0) { const rest = lines[pi].replace(/^.*?[:：]\s*/, ""); product = (rest && rest.length > 8 && rest !== lines[pi] ? rest : (lines.slice(pi + 1, pi + 3).find((l) => /[А-Яа-яA-Za-z]{4}/.test(l)) || "")).replace(/\s*:\s*$/, ""); }
    const t = await readTable(canvas, worker);
    if (!t) return { no: hm ? hm[1] : "", tarix: hm ? dmyFix(hm[2]) : "", product, rows: [], warn: "Cədvəl tapılmadı (xətli cədvəl yoxdur)", page: n };
    // ölçü: sətirlərdə ən çox rast gəlinən; yaxın olanları ona düzəlt
    const sizeOf = (r) => r.name.map((x) => (/\d/.test(x) ? (x.match(/\d+/g) || []).join("") : "")).filter(Boolean).join("x");
    const sizes = t.rows.map(sizeOf); const cnt = {}; sizes.forEach((s) => (cnt[s] = (cnt[s] || 0) + 1));
    const mode = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const rows = []; let sumQty = 0, sumTot = 0;
    t.rows.forEach((r, i) => {
      const comp = r.qty != null && r.price != null ? Math.round(r.qty * r.price * 100) / 100 : null;
      const okRow = (r.name.join("").match(/\d/g) || []).length >= 2 || (comp != null && r.total != null && Math.abs(comp - r.total) <= 0.02);
      if (!okRow || r.qty == null || r.price == null) return;
      let size = sizes[i], flag = "";
      if (size !== mode && mode) { if (lev(size, mode) <= 3 || mode.endsWith(size)) size = mode; else flag = "ölçünü yoxlayın"; }
      let total = r.total; if (total == null || Math.abs(comp - total) > 0.02) { total = comp; flag = (flag ? flag + "; " : "") + "cəm hesablandı (qiymət×miqdar)"; }
      rows.push({ name: [product, size].filter(Boolean).join(" ").trim(), qty: r.qty, price: r.price, total, flag });
      sumQty += r.qty; sumTot += total;
    });
    return { raw: hm ? undefined : text.slice(0, 700), no: hm ? hm[1] : "", tarix: hm ? dmyFix(hm[2]) : "", product, rows, sumQty: Math.round(sumQty * 100) / 100, sumTot: Math.round(sumTot * 100) / 100, page: n };
  }
  return { no: "", tarix: "", product: "", rows: [], warn: "Invoys səhifəsi tapılmadı" };
}
