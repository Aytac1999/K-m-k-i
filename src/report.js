// parse nəticələrindən "Bəyannamələr" və "Mallar" cədvəllərini qurur (düsturlarla).
import { S, serial, colName } from "./xlsx.js";

const rate = (s) => { const m = s && /^(\d+(?:[.,]\d+)?)\s*%/.exec(s); return m ? parseFloat(m[1].replace(",", ".")) / 100 : null; };
const D = (s) => s.split(".").reverse().join("");

export function buildSheets(results, releaseByGb = {}) {
  const Hs = results.map((r) => r.H).sort((a, b) => (D(a.tarix) + a.gb).localeCompare(D(b.tarix) + b.gb));
  const order = Object.fromEntries(Hs.map((h, i) => [h.gb, i]));
  const G = results.flatMap((r) => r.goods).sort((a, b) => order[a.gb] - order[b.gb] || a.mal_no - b.mal_no);
  const pair = {};
  for (const g of G) if (g.gb.startsWith("01") && g.prev_doc) { pair[g.gb] = g.prev_doc; pair[g.prev_doc] = g.gb; }

  const mcols = ["GB nömrəsi", "Növ", "Mal №", "Mal kodu (10 rəqəm)", "Mal adı", "Mənşə ölkə", "Brutto (kq)", "Netto (kq)", "Ölçü vahidi", "Miqdar", "İnvoys №", "İnvoys tarixi", "İnvoys dəyəri", "Gömrük dəyəri (AZN)", "Rüsum dərəcəsi (kod 20)", "ƏDV dərəcəsi (kod 32)", "Kod 02", "Kod 19", "Kod 20 (rüsum)", "Kod 32 (ƏDV)", "Kod 75", "Kod 85", "Ödənişlər cəmi (AZN)", "Valyuta", "Valyuta məzənnəsi (AZN)"];
  const mrows = [mcols.map((t) => ({ v: t, s: S.head }))];
  const hOf = (g) => Hs.find((h) => h.gb === g.gb) || {};
  const curOf = (h) => ({ "978": "EUR", "840": "USD", "944": "AZN" }[h.valyuta_kod] || h.valyuta_kod || "");
  G.forEach((g, i) => {
    const r = i + 2, od = g.odenis || {};
    const unit = { "166": "kq", "168": "ton", "112": "litr", "113": "m³", "055": "m²", "006": "m", "796": "ədəd", "839": "komplekt" }[g.ov_kod] || g.ov_kod || null;
    const m = (c) => od[c]?.mebleg ?? null;
    mrows.push([
      { v: g.gb, s: S.text }, { v: g.gb.startsWith("11") ? "11 İdxal 00" : "01 İdxal 40", s: S.text }, { v: g.mal_no, s: S.intc }, { v: g.kod, s: S.text },
      { v: g.ad, s: S.text }, { v: g.olke ?? null, s: S.text }, { v: g.brutto ?? null, s: S.money }, { v: g.netto ?? null, s: S.money }, { v: unit, s: S.text }, { v: g.miqdar_num ?? null, s: S.money },
      { v: g.inv_no ?? null, s: S.text }, { v: g.inv_tarix ? serial(g.inv_tarix) : null, s: S.date }, { v: g.invoys_deyeri ?? null, s: S.money }, { v: g.gomruk_deyeri ?? null, s: S.money },
      { v: rate(od["20"]?.derece), s: S.pct }, { v: rate(od["32"]?.derece), s: S.pct },
      { v: m("02"), s: S.money }, { v: m("19"), s: S.money }, { v: m("20"), s: S.money }, { v: m("32"), s: S.money }, { v: m("75"), s: S.money }, { v: m("85"), s: S.money },
      { v: { f: `SUM(Q${r}:V${r})` }, s: S.money }, { v: curOf(hOf(g)) || null, s: S.text }, { v: hOf(g).valyuta_mezenne ?? null, s: S.rate4 },
    ].map((c) => (c.v === null ? { v: "", s: c.s } : c)));
  });
  const last = G.length + 1;
  const rng = (col) => `Mallar!$${col}$2:$${col}$${last}`;
  const sumifs = (col, r) => ({ f: `SUMIFS(${rng(col)},${rng("A")},A${r})` });

  const hcols = ["GB nömrəsi", "Növ", "Yaranma tarixi", "Buraxılış tarixi (portal)", "Əlaqəli GB (qısa ↔ tam)", "Göndərən", "İdxalatçı", "Çatdırılma şərti", "Valyuta", "Valyuta məzənnəsi (AZN)", "Mal sayı", "İnvoys dəyəri", "Gömrük dəyəri (AZN)", "Kod 02", "Kod 19", "Kod 20 (rüsum)", "Kod 32 (ƏDV)", "Kod 75", "Kod 85", "Ödənişlər cəmi (AZN)", "PDF-də yazılan ödəniş cəmi", "Fərq", "PDF-də yazılan invoys cəmi", "Fərq (invoys)", "Müqavilə №", "Müqavilə tarixi", "Qr.24 (əqdin xarakteri)"];
  const hrows = [hcols.map((t) => ({ v: t, s: S.head }))];
  Hs.forEach((h, i) => {
    const r = i + 2;
    const cur = { "978": "EUR", "840": "USD", "944": "AZN" }[h.valyuta_kod] || h.valyuta_kod;
    hrows.push([
      { v: h.gb, s: S.text }, { v: h.tip, s: S.text }, { v: serial(h.tarix), s: S.date }, { v: releaseByGb[h.gb] ? serial(releaseByGb[h.gb]) : "", s: S.date },
      { v: pair[h.gb] || "", s: S.text }, { v: h.gonderen || "", s: S.text }, { v: h.alan || "", s: S.text }, { v: h.catdirilma || "", s: S.text }, { v: cur, s: S.text },
      { v: h.valyuta_mezenne ?? "", s: S.rate4 },
      { v: { f: `COUNTIFS(${rng("A")},A${r})` }, s: S.intc }, { ...sumifs("M", r), s: S.money }, { ...sumifs("N", r), s: S.money },
      { ...sumifs("Q", r), s: S.money }, { ...sumifs("R", r), s: S.money }, { ...sumifs("S", r), s: S.money }, { ...sumifs("T", r), s: S.money }, { ...sumifs("U", r), s: S.money }, { ...sumifs("V", r), s: S.money },
      { v: { f: `SUM(N${r}:S${r})` }, s: S.money }, { v: h.odenis_cemi ?? "", s: S.money }, { v: { f: `ROUND(T${r}-U${r},2)` }, s: S.money },
      { v: h.invoys_umumi ?? "", s: S.money }, { v: { f: `ROUND(L${r}-W${r},2)` }, s: S.money },
      { v: h.muqavile_no || "", s: S.text }, { v: (h.muqavile && h.muqavile[0]) ? serial(h.muqavile[0].tarix) : "", s: S.date }, { v: h.qr24 || "", s: S.text },
    ].map((c) => (c.f !== undefined ? { v: { f: c.f }, s: c.s } : c)));
  });
  // yekun sətri
  const n = Hs.length + 1;
  const tot = [{ v: "CƏMİ", s: S.bold }];
  for (let c = 1; c < hcols.length; c++) {
    const L = colName(c);
    const sumCols = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
    tot.push(sumCols.includes(c) ? { v: { f: `SUM(${L}2:${L}${n})` }, s: S.money } : "");
  }
  hrows.push(tot);

  const mw = [17, 13, 7, 17, 40, 9, 12, 12, 9, 12, 12, 12, 15, 15, 12, 12, 11, 11, 13, 13, 11, 11, 15, 13, 13, 11];
  const hw = [17, 13, 12, 14, 17, 28, 18, 12, 8, 12, 8, 14, 14, 11, 11, 13, 13, 11, 11, 15, 15, 10, 15, 12, 18, 14, 16];
  return [
    { name: "Bəyannamələr", rows: hrows, widths: hw, headerHeight: 42, freeze: [1, 1] },
    { name: "Mallar", rows: mrows, widths: mw, headerHeight: 42, freeze: [5, 1], filter: true },
  ];
}
