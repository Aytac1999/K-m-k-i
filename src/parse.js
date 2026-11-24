// GB PDF-lərindən məlumat çıxarır (əvvəlki Python parserinin JS versiyası).
const GBPAT = /(?<!\d)((?:01|11)2\d[15]000\d{6})(?!\d)/g;
const AMT = "\\d[\\d.]*,\\d{2}";
const R = (s, f = "") => new RegExp(s, f);

export function pn(s) {
  s = s.trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return parseFloat(s);
}
// "etiket değer" və ya (sətir sürüşməsi olduqda) "dəyər etiket" formasında dəyəri tapır
const near = (seg, label, val) => {
  const m = R(label + "\\s+(" + val + ")").exec(seg) || R("(" + val + ")\\s+" + label).exec(seg) || R("(" + val + ")[^\\n]*\\n\\s*" + label).exec(seg);
  return m ? m[1] : null;
};

// files: [{n, pages:[text,...]}]  (n — .adoc içindəki PDF nömrəsi)
export function parseDeclaration(files, gbHint = "") {
  files = [...files].sort((a, b) => a.n - b.n);
  const goodsSheets = [];
  let attach = null;
  for (const f of files) {
    if (/Q\s*O\s*Ş\s*M\s*A\s+V\s*Ə\s*R\s*Ə\s*Q/.test(f.pages[0].slice(0, 400))) attach = f.pages.join("\n");
    else goodsSheets.push(...f.pages);
  }
  if (!attach) attach = "";
  if (!goodsSheets.length) throw new Error("Mal vərəqləri tapılmadı");
  const t0 = goodsSheets[0];
  const lines0 = t0.split("\n").filter((l) => l.trim());
  let gb = (attach.slice(0, 300).match(GBPAT) || [])[0];
  if (!gb) gb = (t0.match(GBPAT) || [])[0];
  if (!gb) gb = gbHint;
  if (!gb) throw new Error("GB nömrəsi PDF-dən oxunmadı");
  const idm = /\bID\s+(\d{2})\s+1\$ - /.exec(t0.slice(0, 600)); // qrafa 1: rejim kodu (İD 40, İD 61 ...)
  const H = { gb, tip: gb.startsWith("01") ? `01 İdxal ${idm ? idm[1] : 40}${idm && idm[1] === "61" ? " (saxlanc YGB)" : ""}` : "11 İdxal 00" };
  let hi = lines0.findIndex((l) => /1\$ - [\d,]+ AZN/.test(l));
  if (hi < 0) hi = 0;
  H.tarix = (/\d{2}\.\d{2}\.\d{4}/.exec(lines0[hi]) || [""])[0];
  const mk = /1\$ - ([\d,]+) AZN/.exec(lines0[hi]);
  H.usd_kurs = mk ? pn(mk[1]) : null;
  H.gonderen = (lines0[hi + 1] || "").trim().split(/\s{2,}/)[0].replace(/^"|"$/g, "");
  const head = lines0.slice(0, 14).join("\n");
  const vo = head.match(/(?<!\d)(\d{10})(?!\d)/g) || [];
  H.alan_voen = vo[0] || "";
  const alanLine = lines0.slice(0, 14).find((l) => /"[^"]+"\s*(MMC|ASC|QSC)/.test(l)) || "";
  const am = /("?[^"]+"?\s*[^"]*"?\s*(?:MMC|ASC|QSC))/.exec(alanLine.trim().split(/\s{2,}/).slice(-1)[0] || "");
  H.alan = alanLine.trim().split(/\s{2,}/).find((s) => /(MMC|ASC|QSC)/.test(s))?.replace(/"/g, "") || "";
  if (!H.alan) {
    const ab = { "Məhdud Məsuliyyətli Cəmiyyəti": "MMC", "Açıq Səhmdar Cəmiyyəti": "ASC", "Qapalı Səhmdar Cəmiyyəti": "QSC" };
    const mm = /"([^"]+)"\s*(Məhdud Məsuliyyətli Cəmiyyəti|Açıq Səhmdar Cəmiyyəti|Qapalı Səhmdar Cəmiyyəti)/.exec(head);
    if (mm) H.alan = `${mm[1]} ${ab[mm[2]]}`;
  }
  let m = /(?<!\d)05[ \t]+([A-Z]{3})[ \t]+(\S+)/.exec(t0) || /(?<!\d)\d{2}[ \t]+(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAT|DAP|DDP)[ \t]+(\S+)/.exec(t0);
  H.catdirilma = m ? `${m[1]} ${m[2]}` : "";
  m = R("(?<!\\d)\\d{3}[ \\t]+(\\d{3})[ \\t]+(" + AMT + ")(?:[ \\t]+(\\d,\\d{4})(?:[ \\t]+(\\d{2,3}))?)?").exec(t0);
  // qr.24 (əqdin xarakteri): çatdırılma şərtləri sətrinin sonundakı 3 rəqəmli kod (100, 110, 120, 140 ...)
  {
    const il = lines0.find((l) => /(?<!\d)\d{2}[ \t]+(?:EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAT|DAP|DDP)[ \t]+/.test(l)) || "";
    const q24 = /(?<!\d)(\d{3})(?:[ \t]+\d{2})?\s*$/.exec(il);
    H.qr24 = q24 ? q24[1] : "";
  }
  H.valyuta_kod = m ? m[1] : "";
  H.invoys_umumi = m ? pn(m[2]) : null;
  H.valyuta_mezenne = m && m[3] ? pn(m[3]) : null;
  m = R("^\\s*\\d?\\s*[A-Z]{2}\\s+\\d{3}\\s+(" + AMT + ")\\s+\\d+\\s*$", "m").exec(t0);
  H.umumi_gomruk_deyeri = m ? pn(m[1]) : null;
  H.odenis_cemi_kod = {};
  for (const x of t0.matchAll(R("(\\d{2})\\s+-\\s+(" + AMT + ")\\s+-\\s+932", "g"))) H.odenis_cemi_kod[x[1]] = pn(x[2]);
  m = R("Cəmi\\s*:\\s*(" + AMT + ")\\s*AZN").exec(t0);
  H.odenis_cemi = m ? pn(m[1]) : null;

  // 1-ci vərəq, 44-cü qrafa: "8001 - <invoys №> <tarix> <məbləğ>" (invoys sənədinin kodu)
  H.inv8001 = [];
  for (const x of t0.matchAll(/(?:^|\n)\s*8001\s+-\s+(.+?)\s+(\d{2}\.\d{2}\.\d{4})(?:\s+(\d[\d\s.,]*))?\s*(?=\n|$)/g))
    H.inv8001.push({ no: x[1].trim(), tarix: x[2], deyer: x[3] ? pn(x[3].trim()) : null });

  // mal vərəqlərində "Mal mövqeyi N ... Miqdar 1 <say> <vahid>" (ehtiyat mənbə)
  const qty1 = {};
  for (const sheet of [...goodsSheets, attach]) {
    const parts = sheet.split(/Mal mövqeyi\s+(\d+)/);
    for (let i = 1; i < parts.length; i += 2) {
      const m = R("Miqdar 1\\s+(" + AMT + ")\\s*(\\S+)").exec(parts[i + 1] || "");
      if (m && !qty1[parseInt(parts[i], 10)]) qty1[parseInt(parts[i], 10)] = [m[1], m[2]];
    }
  }
  // "Mal mövqeyi N" sətri qırılıbsa (nömrə başqa sətrə düşüb): "Miqdar 1" sıra ilə mallara aid edilir
  {
    const all = [...[...goodsSheets, attach].join("\n").matchAll(R("Miqdar 1\\s+(" + AMT + ")\\s*(\\S+)", "g"))];
    all.forEach((m, k) => { if (!qty1[k + 1]) qty1[k + 1] = [m[1], m[2]]; });
  }
  // 44-cü qrafa: müqavilə sənədi. Əvvəl 4011, o yoxdursa 4041 ("kod - <№> <tarix>"); 1-ci vərəqdə və ya qoşma vərəqdə ola bilər
  const findDocs = (code) => {
    const out = [], seenM = new Set();
    for (const x of (t0 + "\n" + attach).matchAll(new RegExp("(?:^|\\n)\\s*" + code + "\\s*-\\s*(.+?)\\s+(\\d{2}\\.\\d{2}\\.\\d{4})", "g"))) {
      const key = x[1].trim() + "|" + x[2];
      if (!seenM.has(key)) { seenM.add(key); out.push({ no: x[1].trim(), tarix: x[2] }); }
    }
    return out;
  };
  H.muqavile = findDocs("4011");
  H.muqavile_kod = H.muqavile.length ? "4011" : "";
  if (!H.muqavile.length) { H.muqavile = findDocs("4041"); if (H.muqavile.length) H.muqavile_kod = "4041"; }
  H.muqavile_no = H.muqavile.map((m) => m.no).join("; ");
  H.muqavile_tarix = H.muqavile.map((m) => m.tarix).join("; ");

  // qoşma vərəq: invoys və daşınma payı
  const inv = {}, cost = {};
  const ms = [...attach.matchAll(/(\d+)\s+saylı mal mövqeyi üzrə\s*\((\d{10})\)/g)];
  ms.forEach((mm, k) => {
    const end = k + 1 < ms.length ? ms[k + 1].index : attach.length;
    const seg = attach.slice(mm.index + mm[0].length, end);
    const n = parseInt(mm[1], 10);
    if (seg.includes("İnvoysun nömrəsi")) {
      let q = R("Malın miqdarı\\s+(" + AMT + ")\\s*(\\w+)").exec(seg);
      // yazılış sətri qırılıbsa, say yuxarı sətirdə təkcə "288,00 kq" şəklində olur
      if (!q) for (const l of seg.split("\n").slice(0, 4)) { const m5 = R("^\\s{40,}(" + AMT + ")\\s+([A-Za-zƏəİıÖöÜüŞşÇçĞğ³²\\d]{1,6})\\s*$").exec(l); if (m5) { q = m5; break; } }
      const dv = near(seg, "İnvoys dəyəri", AMT);
      inv[n] = {
        inv_no: ((v) => (v && !/^(İnvoys\w*|Malın|Mal)$/i.test(v) ? v : undefined))(/İnvoysun nömrəsi[ \t]+(\S+)/.exec(seg)?.[1]),
        inv_tarix: near(seg, "İnvoysun tarixi", "\\d{2}\\.\\d{2}\\.\\d{4}"),
        inv_deyer: dv ? pn(dv) : null,
        miqdar: q ? [q[1], q[2]] : null,
      };
    }
    if (seg.includes("daşınma xərcinin payı")) {
      const a = near(seg, "Məbləğ AZN", AMT);
      const u = near(seg, "Məbləğ USD", AMT);
      cost[n] = { dasinma_azn: a ? pn(a) : null, dasinma_usd: u ? pn(u) : null };
    }
  });
  H._prev_val = {};
  for (const x of attach.matchAll(R("Bəyannamənin taixi\\s+(\\d{2}\\.\\d{2}\\.\\d{4})[^\\n]*?(" + AMT + ")", "g"))) {
    const before = attach.slice(0, x.index);
    const gbs = [...before.slice(-400).matchAll(GBPAT)];
    const gbn = gbs.length ? gbs[gbs.length - 1][1] : (attach.slice(x.index, x.index + 200).match(GBPAT) || [])[0];
    const q40 = before.lastIndexOf("Qrafa 40");
    const sect = q40 >= 0 ? before.slice(q40) : before;
    let ml = [...sect.matchAll(/(\d+)- mala aiddir(?!\.)/g)].pop() || [...sect.matchAll(/Mal mövqeyi\s+(\d+)/g)].pop();
    if (!ml) ml = /Mal mövqeyi\s+(\d+)/.exec(attach.slice(x.index));
    if (ml && gbn) H._prev_val[`${gbn}|${parseInt(ml[1], 10)}`] = { tarix: x[1], gomruk: pn(x[2]) };
  }

  const rowpat = /(?<!\d)(\d{2})[ \t]+(\d+(?:,\d+)?)[ \t]+(?:(\d+(?:[.,]\d+)?[ \t]*(?:%|AZN))[ \t]+)?(\d+(?:,\d+)?)[ \t]+01(?!\d)/g;
  const goods = [];
  const pageGoodsTotal = new Set(ms.map((x) => x[1])).size || 1;
  for (const pg of goodsSheets) {
    const lines = pg.split("\n");
    const idx = [];
    lines.forEach((l, i) => { if (/(\d{1,2})[ \t]+(\d{6})[ \t]+(\d{4})[ \t]*$/.test(l)) idx.push(i); });
    const pageGoods = [];
    idx.forEach((i, k) => {
      const j = k + 1 < idx.length ? idx[k + 1] : lines.length;
      const blk = lines.slice(i, j);
      const mm = /(\d{1,2})[ \t]+(\d{6})[ \t]+(\d{4})[ \t]*$/.exec(lines[i]);
      const g = { gb, mal_no: parseInt(mm[1], 10), kod: mm[2] + mm[3] };
      let name = "";
      const cand = i >= 2 ? [lines[i], lines[i - 1], lines[i - 2]] : [lines[i]];
      for (const l of cand) {
        if (l.trim().startsWith("Malın adı:")) { name = l.trim().split(/\s{2,}/)[0].replace(/^Malın adı:\s*/, ""); break; }
      }
      if (!name) {
        const seg0 = lines[i].trim().split(/\s{2,}/)[0];
        if (seg0 && !/^[A-Z]{4}\d{7}$/.test(seg0) && !/^\d/.test(seg0)) name = seg0;
      }
      if (!name) {
        const sub = blk.slice(1, 6);
        for (let q = 0; q < sub.length; q++) {
          const seg = sub[q].trim().split(/\s{2,}/)[0];
          if (seg) {
            name = seg.replace(/^Malın adı:\s*/, "");
            // ad ikinci sətirə keçibsə (açıq mötərizə), davamını əlavə edirik
            for (let w = q + 1, n = 0; w < sub.length && n < 3 && (name.match(/\(/g) || []).length > (name.match(/\)/g) || []).length; w++, n++) {
              const nx = sub[w].trim().split(/\s{2,}/)[0];
              if (nx) name += " " + nx;
            }
            break;
          }
        }
      }
      g.ad = name.replace(/^\d+\.\s*/, "").replace(/\s*:\s*$/, "");
      const mp = /İstehsalçı:\s*(.+?)(?:\s{2,}|$)/m.exec(blk.join("\n"));
      g.istehsalci = mp ? mp[1].trim() : "";
      let bi = null;
      blk.slice(0, 10).some((l, q) => {
        const m2 = /(?:\b([A-Z]{2})[ \t]+(\d{3})|\b(\d{3})[ \t]+([A-Z]{2}))[ \t]+(\d+(?:,\d+)?)/.exec(l);
        if (m2) { g.olke = m2[1] || m2[4]; g.brutto = pn(m2[5]); bi = q; return true; }
        return false;
      });
      let netto = null;
      for (const l of blk.slice((bi ?? 0) + 1, (bi ?? 0) + 8)) {
        const m3 = /\b00[ \t]+00[ \t]+(\d+(?:,\d+)?)/.exec(l) || /^\s{30,}(\d+(?:,\d+)?)\s*$/.exec(l);
        if (m3) { netto = pn(m3[1]); break; }
      }
      g.netto = netto;
      let ui = null;
      blk.some((l, q) => {
        const m4 = R("\\b(\\d{3})[ \\t]{2,}(" + AMT + ")(?:[ \\t]+\\d){0,3}[ \\t]*$").exec(l);
        if (m4 && !l.includes("kq")) { g.ov_kod = m4[1]; g.invoys_deyeri = pn(m4[2]); ui = q; return true; }
        return false;
      });
      const tail = [];
      for (const l of blk.slice((ui ?? 0) + 1, (ui ?? 0) + 16)) {
        const m5 = R("\\s(" + AMT + ")\\s*$").exec(l);
        if (m5 && !l.includes("%") && l.trimEnd().length > 90) tail.push(pn(m5[1]));
      }
      g.gomruk_deyeri = tail.length > 0 ? tail[0] : null;
      g.stat_deyer_usd = tail.length > 1 ? tail[1] : null;
      g.prev_doc = gb.startsWith("01") ? ((blk.join("\n").match(/(?<!\d)(112\d5000\d{6})(?!\d)/) || [""])[0]) : "";
      pageGoods.push(g);
    });

    const rowsByLine = [];
    for (const l of lines) {
      const mm2 = [...l.matchAll(rowpat)];
      if (mm2.length) rowsByLine.push(mm2.map((m) => [m[1], pn(m[2]), m[3], pn(m[4])]));
    }
    const blocks = [];
    let prev = null;
    for (const r of rowsByLine) {
      const c0 = parseInt(r[0][0], 10);
      if (prev === null || c0 <= prev) blocks.push([]);
      blocks[blocks.length - 1].push(r);
      prev = c0;
    }
    const groups = [];
    for (const b of blocks) {
      const ncol = Math.max(...b.map((r) => r.length));
      for (let col = 0; col < ncol; col++) groups.push(b.filter((r) => r.length > col).map((r) => r[col]));
    }
    if (groups.length && groups.length !== pageGoods.length) for (const g of pageGoods) g._flag = `groups ${groups.length} != goods ${pageGoods.length}`;
    pageGoods.forEach((g, i) => {
      g.odenis = {};
      if (groups[i]) for (const [c, base, rate, amt] of groups[i]) g.odenis[c] = { baza: base, derece: rate, mebleg: amt };
      Object.assign(g, inv[g.mal_no] || {}, cost[g.mal_no] || {});
      // malın miqdarı: qoşma vərəqdəki "Malın miqdarı", yoxdursa mal vərəqindəki "Miqdar 1"
      {
        let q = (inv[g.mal_no] && inv[g.mal_no].miqdar) || qty1[g.mal_no] || null;
        const isKg = (u) => /^k[qg]$/i.test(u || "");
        const q1 = qty1[g.mal_no];
        // qoşma vərəqdə miqdar kq ilə (çəki) yazılıbsa, mal vərəqindəki "Miqdar 1" (məs. m3) əsas götürülür
        if (q && isKg(q[1]) && q1 && !isKg(q1[1])) q = q1;
        // "Miqdar 1" netto çəkinin eynisidirsə (GB-də səhv doldurulub), tək mallı GB-də 31-ci qrafadakı həcm götürülür
        if (q && !isKg(q[1]) && g.netto != null && Math.abs(pn(q[0]) - g.netto) < 0.005 && pageGoodsTotal === 1) {
          const y = /YER SAYI[^\n]*?\s(\d+(?:[.,]\d+)?)\s*(m3|m³)/.exec(t0);
          if (y) q = [y[1], y[2]];
        }
        g.miqdar_num = q ? pn(q[0]) : null;
        g.miqdar_vahid = q ? q[1] : "";
      }
      // qoşma vərəqdə invoys nömrəsi yoxdursa, 1-ci vərəqdəki 8001 sətrindən götürülür
      if (!g.inv_no && H.inv8001.length) { const e = H.inv8001[0]; g.inv_no = e.no; if (!g.inv_tarix) g.inv_tarix = e.tarix; }
      goods.push(g);
    });
  }
  H.mal_sayi = goods.length;
  return { H, goods };
}

// Qısa GB-nin gömrük dəyəri tam GB-nin qoşma vərəqindən (qrafa 40) götürülür
export function applyPrevValues(results) {
  const pv = {};
  for (const { H } of results) for (const [k, v] of Object.entries(H._prev_val || {})) pv[k] = v;
  for (const { H, goods } of results) {
    if (!H.gb.startsWith("11")) continue;
    for (const g of goods) {
      const v = pv[`${H.gb}|${g.mal_no}`];
      if (v) { g.gomruk_deyeri = v.gomruk; g.gomruk_menbe = "01 GB qoşma vərəqi (qrafa 40)"; }
    }
  }
  for (const { H } of results) delete H._prev_val;
}
