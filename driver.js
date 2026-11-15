// Gömrük portalının iç çərçivəsində (egbtrader*.customs.gov.az) işləyir; panelin əmrlərini səhifədə icra edir.
(() => {
  if (!location.hostname.startsWith("egbtrader")) return;
  if (window.__gomrukDriver) return;
  window.__gomrukDriver = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => ((el.innerText !== undefined ? el.innerText : el.textContent) || el.value || el.alt || el.title || "").replace(/\s+/g, " ").trim();
  const DATE = /^\d{2}\.\d{2}\.\d{4}$/;

  async function waitFor(fn, ms = 15000, step = 250) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await sleep(step);
    }
  }
  function byText(re, scope = document) {
    const all = [...scope.querySelectorAll("a,button,input,td,span,div,label,b,u,img")];
    return all.filter((e) => re.test(txt(e)) && txt(e).length < 90).sort((a, b) => txt(a).length - txt(b).length)[0];
  }
  const fire = (el) => { if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true; };

  // ---------- siyahı ----------
  function rows(root = document) {
    const out = [];
    root.querySelectorAll("tr").forEach((tr) => {
      if (tr.querySelector("tr")) return;
      const cells = [...tr.children];
      const gi = cells.findIndex((c) => /^\d{14}$/.test(txt(c)));
      if (gi < 0) return;
      const dates = cells.map(txt).filter((t) => DATE.test(t));
      const gb = txt(cells[gi]);
      const created = DATE.test(txt(cells[gi + 1] || {})) ? txt(cells[gi + 1]) : dates[1] || dates[0] || "";
      const op = DATE.test(txt(cells[gi - 1] || {})) ? txt(cells[gi - 1]) : dates[0] || "";
      const tipTxt = cells.map(txt).find((t) => /^(01|11)\s*İdxal\s*\d+/.test(t)) || "";
      out.push({ gb, created, op, tip: gb.startsWith("01") ? "tam" : "qisa", tipTxt, tr, cells });
    });
    return out;
  }
  const dkey = (d) => { const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d || ""); return m ? m[3] + m[2] + m[1] : ""; };
  // Eyni GB nömrəsi təkrarlanarsa ən son əməliyyat tarixli sətir qalır
  const keepLatest = (map, r) => { const o = map.get(r.gb); if (!o || dkey(r.op) >= dkey(o.op)) map.set(r.gb, r); };
  const plain = (r) => ({ gb: r.gb, created: r.created, op: r.op, tip: r.tip });

  // ---------- filtrlər ----------
  function pickOption(sel, tests) {
    const o = [...sel.options].find((o) => tests.every((t) => t.test(o.text)));
    if (!o) return false;
    sel.value = o.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  async function applyFilters({ from, to, rep }) {
    const sels = [...document.querySelectorAll("select")];
    if (!sels.length) return { error: "Siyahı səhifəsi açıq deyil (Əsas səhifə)." };
    let okAll = false, okRep = false;
    for (const s of sels) {
      okAll = pickOption(s, [/buraxılmış gb/i]) || okAll;
      okRep = pickOption(s, [/təmsilçi/i, new RegExp(rep === "rehber" ? "rəhbər" : "sahibkar", "i")]) || okRep;
    }
    if (!okRep) return { error: "'Təmsilçi tərəfindən tərtib olunmuş' seçimi tapılmadı." };
    await sleep(300);
    // Səhifə təzə yüklənibsə düymə gec gələ bilər
    const openBtn = await waitFor(() => byText(/^Ətraflı axtarış$/), 10000);
    if (!openBtn) return { error: "«Ətraflı axtarış» düyməsi tapılmadı" };
    fire(openBtn);
    const findDlg = () => [...document.querySelectorAll("div,table")]
      .filter((d) => d.offsetParent !== null && /Göndərənin kodu/.test(d.innerText || "") && d.querySelectorAll("input[type=text],input:not([type])").length >= 2)
      .sort((x, y) => x.innerText.length - y.innerText.length)[0];
    const dlg = await waitFor(findDlg, 8000);
    if (!dlg) return { error: "«Ətraflı axtarış» pəncərəsi açılmadı" };
    const cb = dlg.querySelector("input[type=checkbox]");
    if (cb && !cb.checked) cb.click();
    // Yalnız mətn xanaları (təqvim ikonları və düymələr sayılmır); ilk ikisi tarixlərdir
    const ins = [...dlg.querySelectorAll("input")].filter((i) => (i.type === "text" || i.type === "") && i.offsetParent !== null);
    const setv = (i, v) => {
      i.focus(); i.value = v;
      ["keydown", "keyup", "input", "change", "blur"].forEach((e) => i.dispatchEvent(new Event(e, { bubbles: true })));
    };
    if (ins[0]) setv(ins[0], from);
    if (ins[1]) setv(ins[1], to);
    await sleep(200);
    // yoxlama: xanalarda düzgün tarix qalıbmı
    if (ins[0] && ins[0].value !== from) setv(ins[0], from);
    if (ins[1] && ins[1].value !== to) setv(ins[1], to);
    if (!ins[1] || ins[1].value !== to) return { error: `Son tarix xanası doldurulmadı (gözlənilən ${to}, xanada «${ins[1] ? ins[1].value : "yoxdur"}»)` };
    const go = [...dlg.querySelectorAll("input,button")].filter((b) => /^Axtar$/.test(txt(b))).pop() || [...document.querySelectorAll("input,button")].filter((b) => /^Axtar$/.test(txt(b))).pop();
    fire(go);
    const got = await waitFor(() => rows().length, 25000);
    if (got) return { rows: rows().map(plain) };
    // sətir yoxdur: portalın mesajını oxuyuruq (boş nəticə, tarix limiti və s.)
    const msg = [...document.querySelectorAll("span,div,td,font,b")]
      .filter((e) => e.offsetParent !== null && /tapılmadı|tapılmayıb|olmamalıdır|səhv|xəta|boşdur|məlumat yoxdur/i.test(txt(e)) && txt(e).length < 160)
      .map((e) => txt(e)).filter((t, i, a) => a.indexOf(t) === i).slice(0, 3).join(" | ");
    // portal aydın səhv yazırsa (tarix limiti və s.) xəta; əks halda aralıq sadəcə boşdur
    if (/olmamalıdır|səhv|xəta/i.test(msg)) return { error: "Portal: " + msg };
    return { rows: [], empty: true, msg };
  }

  // ---------- səhifələmə ----------
  function pagerCell() {
    const cells = [...document.querySelectorAll("td")].filter((td) => /^\d{1,3}(\s+\d{1,3})*$/.test(txt(td)) && (td.querySelector("a") || td.colSpan > 3 || td.querySelectorAll("span,b,u").length));
    return cells.pop() || null;
  }
  function pagerLinks() {
    // 1) GridView tipli: href/onclick-də Page$N olan keçidlər
    const pg = [...document.querySelectorAll("a")].filter((a) => /Page\$\d+/.test((a.getAttribute("href") || "") + (a.getAttribute("onclick") || "")) && /^\d{1,3}$/.test(txt(a)));
    if (pg.length) return pg;
    // 2) Cədvəlin altındakı "1 2 3" səhifə nömrələri
    const cell = pagerCell();
    if (!cell) return [];
    return [...cell.querySelectorAll("a,span,b,u")].filter((e) => /^\d{1,3}$/.test(txt(e)) && !e.querySelector("a,span,b,u"));
  }
  const clickable = (e) => e.closest("a") || (e.tagName === "A" ? e : null);
  // Cari səhifənin sətirləri + keçid mümkün olan səhifə nömrələri
  async function pageInfo() {
    const links = pagerLinks().filter((e) => clickable(e)).map((e) => parseInt(txt(e), 10));
    const c = pagerCell();
    return { rows: rows().map(plain), pages: [...new Set(links)], sig: rows().map((r) => r.gb).join(), dbg: links.length ? "" : (c ? c.outerHTML.slice(0, 700) : "pager hüceyrəsi tapılmadı; Page$ keçid sayı: " + document.querySelectorAll("a[href*='Page$']").length) };
  }
  // Səhifə nömrəsinə klik: postback səhifəni yenilədiyi üçün cavab əvvəlcədən göndərilir
  // Səhifə keçidinin postback hədəfi (səhifənin öz dünyasında çağırmaq üçün)
  async function pageTarget(arg) {
    const n = arg && typeof arg === "object" ? arg.n : arg;
    const el = pagerLinks().find((e) => parseInt(txt(e), 10) === n);
    const a = el && clickable(el);
    const raw = a ? (a.getAttribute("href") || "") + " " + (a.getAttribute("onclick") || "") : "";
    const m = /__doPostBack\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/.exec(raw);
    return { t: m ? m[1] : "ctl00$ContentPlaceHolder1$gvCCDMain", a: m ? m[2] : "Page$" + n, raw: raw.slice(0, 160), found: !!el };
  }
  async function gotoPage(arg) {
    const n = arg && typeof arg === "object" ? arg.n : arg;
    const el = pagerLinks().find((e) => parseInt(txt(e), 10) === n && clickable(e));
    if (!el) return { error: "Səhifə nömrəsi tapılmadı: " + n };
    setTimeout(() => fire(clickable(el)), 80);
    return { ok: true, nav: true };
  }
  // Bütün səhifələri səhifəni dəyişmədən, __doPostBack(grid,'Page$N') sorğusunu özümüz göndərərək oxuyuruq
  async function listAll() {
    const gridOf = (root) => {
      const m = /__doPostBack\(\s*['"]([^'"]*gvCCDMain[^'"]*)['"]/.exec([...root.querySelectorAll("[onclick],a[href]")].map((e) => (e.getAttribute("onclick") || "") + (e.getAttribute("href") || "")).join(" "));
      return m ? m[1] : "ctl00$ContentPlaceHolder1$gvCCDMain";
    };
    const grid = gridOf(document);
    const pages = [{ n: 1, rows: rows().map(plain) }];
    const seenSig = new Set([pages[0].rows.map((r) => r.gb).join()]);
    let root = document, err = "";
    for (let n = 2; n <= 300; n++) {
      const form = root.querySelector("form");
      const fd = new FormData(form);
      fd.set("__EVENTTARGET", grid); fd.set("__EVENTARGUMENT", "Page$" + n);
      const body = new URLSearchParams([...fd].filter(([, v]) => typeof v === "string"));
      let html;
      try {
        const r = await fetch(new URL(form.getAttribute("action") || location.href, location.href).href, { method: "POST", body, credentials: "same-origin", headers: { Accept: "text/html,application/xhtml+xml" } });
        if (!r.ok) { err = "cavab " + r.status; break; }
        html = await r.text();
      } catch (e) { err = e.message; break; }
      root = new DOMParser().parseFromString(html, "text/html");
      const rs = rows(root).map(plain);
      const sig = rs.map((r) => r.gb).join();
      if (!rs.length || seenSig.has(sig)) break;
      seenSig.add(sig);
      pages.push({ n, rows: rs });
    }
    return { pages, err };
  }
  async function hasRow({ gb }) { return { has: rows().some((r) => r.gb === gb) }; }
  async function allRows() {
    const seen = new Map();
    for (const r of rows()) keepLatest(seen, plain(r));
    return [...seen.values()];
  }

  // ---------- sətir seçmək və GB-ni açmaq ----------
  async function openGb(arg) {
    const gb = arg && typeof arg === "object" ? arg.gb : arg;
    const r = rows().find((x) => x.gb === gb);
    if (!r) return { error: "GB siyahıda yoxdur: " + gb };
    const sel = r.cells[0].querySelector("input,button,a,div") || r.cells[0];
    fire(sel);
    // sətir seçimi postback-dir: səhifə yenilənəndən sonra "Baxış" düyməsi aktivləşir
    await sleep(600);
    const view = await waitFor(() => { const b = byText(/^Baxış$/); return b && !b.disabled ? b : null; }, 15000);
    if (!view) return { error: "Baxış düyməsi aktivləşmədi: " + gb };
    // Səhifə dəyişəcək (GBEditor.aspx): cavabı əvvəlcədən göndəririk, klik bir az sonra olur
    setTimeout(() => fire(view), 80);
    return { ok: true, nav: true };
  }
  // İmza ikonu (.adoc) - siyahıdan
  async function clickSignIcon(arg) {
    const gb = arg && typeof arg === "object" ? arg.gb : arg;
    const r = rows().find((x) => x.gb === gb);
    if (!r) return { error: "GB siyahıda yoxdur: " + gb };
    const last = r.cells[r.cells.length - 1];
    const icon = last.querySelector("img,input,a,button") || last;
    fire(icon);
    return { ok: true };
  }
  // GB açıqdır: Yekun -> Addım 1 -> lupa düymələri
  async function openStep1() {
    // GB açıq olanda ümumi səhifədəki "Barkod - qalıq çəki | Sənədlər" cədvəli (İnvoys / CMR / Digər sənədlər)
    const ok = await waitFor(() => step1Buttons().length, 12000);
    if (!ok) return { error: "Sənəd düymələri tapılmadı (ümumi səhifədəki barkod cədvəli)" };
    return { ok: true, buttons: step1Buttons().map((b) => ({ label: b.label, n: b.n })) };
  }
  // mode "general": ümumi səhifədəki barkod cədvəli (İnvoys / CMR / Digər sənədlər)
  // mode "addim": Yekun -> Addım 1 bölməsindəki lupa düymələri (Müşayiət sənədləri və s.)
  function step1Buttons(mode = "general") {
    const out = [], cnt = {};
    const add = (label, btn) => { cnt[label] = (cnt[label] || 0) + 1; out.push({ label, n: cnt[label], btn }); };
    if (mode === "general") {
      const head = byText(/^Barkod\s*-\s*qalıq çəki$/);
      const tbl = head && head.closest("table");
      if (tbl) {
        for (const tr of tbl.querySelectorAll("tr")) {
          const cells = [...tr.children];
          if (cells.length < 2) continue;
          const cell = cells[cells.length - 1], t = txt(cell);
          const label = /^[İI]nvoys$/i.test(t) ? "invoys" : /^CMR$/i.test(t) ? "cmr" : /^Digər sənədlər$/i.test(t) ? "diger" : null;
          if (label) add(label, cell.querySelector("a,input,button,img") || cell);
        }
      }
      return out;
    }
    const defs = [
      ["invoys", /İnvoysların surəti/],
      ["cmr", /Nəqliyyat sənədlərinin \(CMR/],
      ["musayiet", /Müşayiət sənədlərinin/],
    ];
    for (const [label, re] of defs) {
      const l = byText(re);
      if (!l) continue;
      const box = l.closest("tr") || l.parentElement;
      const btn = box && box.querySelector("img,input[type=image],button,a");
      if (btn) add(label, btn);
    }
    return out;
  }
  // Yekun tabına keçid (səhifə dəyişir: cavabı əvvəlcədən göndəririk)
  async function goYekun() {
    // "Yekun" tabı: image-submit düyməsi btnStep5 (HL5 isə ona bağlı mətn keçididir)
    const el = document.getElementById("ctl00_ContentPlaceHolder1_btnStep5") || document.getElementById("ctl00_ContentPlaceHolder1_HL5");
    if (!el) return { error: "Yekun tapılmadı" };
    setTimeout(() => fire(el), 80);
    return { ok: true, nav: true };
  }
  const ADDIM = /^Addım\s*1\b/i;
  async function goAddim1() {
    const a = byText(ADDIM);
    if (!a) return { error: "Addım 1 tapılmadı", seen: await yekunInfo() };
    setTimeout(() => fire(a.closest("a,input,button") || a), 80);
    return { ok: true, nav: true };
  }
  // Diaqnostika: Yekun səhifəsində "Addım / Müşayiət / surəti" mətnləri olan elementlər
  async function yekunInfo() {
    return [...document.querySelectorAll("a,input,button,td,span,div,img,b,u")]
      .filter((e) => /Addım|Müşayiət|surəti|Nəqliyyat sənəd/i.test(txt(e)) && txt(e).length < 90)
      .slice(0, 25).map((e) => `${e.tagName}#${e.id || ""}:${txt(e).slice(0, 50)}`);
  }
  async function addimInfo() {
    const ok = await waitFor(() => step1Buttons("addim").length, 8000);
    if (!ok) return { error: "Addım 1 bölməsində sənəd düymələri tapılmadı" };
    return { ok: true, buttons: step1Buttons("addim").map((b) => ({ label: b.label, n: b.n })) };
  }
  async function clickStep1(arg) {
    const label = arg && typeof arg === "object" ? arg.label : arg;
    const n = (arg && arg.n) || 1;
    const b = step1Buttons((arg && arg.mode) || "general").find((x) => x.label === label && x.n === n);
    if (!b) return { error: "Düymə yoxdur: " + label };
    fire(b.btn);
    return { ok: true };
  }
  async function backToList() {
    const link = byText(/^Əsas səhifə$/);
    if (!link) return { error: "Əsas səhifə düyməsi tapılmadı" };
    setTimeout(() => fire(link), 80);
    return { ok: true, nav: true };
  }

  // ---------- POST-back ilə faylı birbaşa çəkmək (brauzer yükləməsinə ehtiyac qalmır) ----------
  function ctl(el) { return el && (el.closest("a,button,input") || el); }
  function postSpec(el) {
    el = ctl(el);
    const form = el.form || el.closest("form") || document.forms[0];
    const fd = new FormData(form);
    const type = (el.type || "").toLowerCase();
    const code = (el.getAttribute("href") || "") + " " + (el.getAttribute("onclick") || "");
    const m = /__doPostBack\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/.exec(code) || /WebForm_PostBackOptions\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]/.exec(code);
    if (m) { fd.set("__EVENTTARGET", m[1]); fd.set("__EVENTARGUMENT", m[2]); }
    else if (type === "image" && el.name) { fd.set(el.name + ".x", "8"); fd.set(el.name + ".y", "8"); }
    else if (el.name) fd.set(el.name, el.value || "");
    return { form, fd };
  }
  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  async function postFetch(el) {
    if (!el) return { error: "düymə tapılmadı" };
    el = ctl(el);
    const { form, fd } = postSpec(el); // klik etmirik: səhifə yenilənməsin
    const urlenc = !/multipart/i.test(form.enctype || "");
    const body = urlenc ? new URLSearchParams([...fd].filter(([, v]) => typeof v === "string")) : fd;
    const url = new URL(form.getAttribute("action") || location.href, location.href).href;
    const r = await fetch(url, { method: "POST", body, credentials: "same-origin", headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } });
    const type = r.headers.get("content-type") || "";
    const disp = r.headers.get("content-disposition") || "";
    if (!r.ok) return { error: "cavab " + r.status };
    if (/text\/html|json/i.test(type) && !/attachment/i.test(disp)) {
      const html = await r.text();
      const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "";
      const tt = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
      const red = /(?:window\.open|location\.href\s*=|location\.replace)\s*\(?\s*['"]([^'"]+)['"]/.exec(html);
      // Səhifə faylı başqa ünvandan açdırırsa, onu çəkirik
      if (red && !/^javascript:/i.test(red[1])) {
        try {
          const r2 = await fetch(new URL(red[1], location.href).href, { credentials: "same-origin" });
          const t2 = r2.headers.get("content-type") || "";
          if (r2.ok && !/text\/html/i.test(t2)) {
            const buf2 = await r2.arrayBuffer();
            return { ok: true, type: t2, disp: r2.headers.get("content-disposition") || "", size: buf2.byteLength, b64: b64(buf2) };
          }
        } catch (_) {}
      }
      return { error: `fayl əvəzinə səhifə gəldi (${r.status}, ${type}, ${html.length} bayt, viewstate:${/__VIEWSTATE/.test(html)}, title:«${title.trim().slice(0, 60)}», mətn:«${tt}»${red ? ", yönləndirmə:" + red[1].slice(0, 80) : ""})` };
    }
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return { error: "boş cavab" };
    return { ok: true, type, disp, size: buf.byteLength, b64: b64(buf) };
  }
  async function fetchSignIcon({ gb }) {
    const r = rows().find((x) => x.gb === gb);
    if (!r) return { error: "GB siyahıda yoxdur: " + gb };
    const last = r.cells[r.cells.length - 1];
    return postFetch(last.querySelector("img,input,a,button") || last);
  }
  async function fetchStep1({ label, n = 1, mode = "general" }) {
    const b = step1Buttons(mode).find((x) => x.label === label && x.n === n);
    return b ? postFetch(b.btn) : { error: "Düymə yoxdur: " + label };
  }
  // kəşfiyyat: səhifənin düymə və mətnlərini qaytarır (selektorları dəqiqləşdirmək üçün)
  function inspect() {
    const items = [...document.querySelectorAll("a,button,input,img,select")].map((e) => ({
      tag: e.tagName, type: e.type || "", text: txt(e).slice(0, 60), id: e.id || "", name: e.name || "",
      onclick: (e.getAttribute("onclick") || "").slice(0, 120), src: (e.getAttribute("src") || "").slice(-40),
    }));
    const forms = [...document.forms].map((f) => ({
      action: (f.getAttribute("action") || "").replace(/Token=[^&]+/, "Token=…"), method: f.method, enctype: f.enctype,
      fieldNames: [...f.elements].map((e) => e.name).filter(Boolean).slice(0, 80),
    }));
    const lupas = [...document.querySelectorAll("input[type=image],img")].filter((e) => !/^\s*$/.test(e.outerHTML)).map((e) => e.outerHTML.slice(0, 260)).slice(0, 40);
    const signs = rows().slice(0, 2).map((r) => r.cells[r.cells.length - 1].innerHTML.slice(0, 400));
    const bh = byText(/^Barkod\s*-\s*qalıq çəki$/), bt = bh && bh.closest("table");
    const barcode = bt ? bt.outerHTML.slice(0, 2500) : "";
    return { url: location.href.replace(/Token=[^&]+/, "Token=…"), forms, lupas, signs, barcode, items: items.slice(0, 200) };
  }

  const H = {
    ping: async () => ({ ok: true, list: rows().length, sig: rows().map((r) => r.gb).join(), hasStep1: !!byText(/^Yekun$/), hasAddim1: !!byText(/^Addım\s*1\b/i), hasMus: step1Buttons("addim").length > 0, sel: document.querySelectorAll("select").length, host: location.hostname }),
    applyFilters, allRows, pageInfo, gotoPage, pageTarget, listAll, hasRow, openGb, clickSignIcon, openStep1, clickStep1, backToList, fetchSignIcon, fetchStep1, goYekun, goAddim1, addimInfo, yekunInfo,
    inspect: async () => inspect(),
  };
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!msg || msg.target !== "driver" || !H[msg.cmd]) return;
    H[msg.cmd](msg.args || {}).then(reply).catch((e) => reply({ error: String(e && e.message || e) }));
    return true;
  });
})();
