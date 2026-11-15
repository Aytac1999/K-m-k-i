import * as pdfjs from "./lib/pdf.min.mjs";
import { pdfPages } from "./src/layout.js";
import { parseDeclaration, applyPrevValues } from "./src/parse.js";
import { buildSheets } from "./src/report.js";
import { buildXlsx } from "./src/xlsx.js";
import { readAdoc, mergePdfs, isoDate, cleanName } from "./src/adoc.js";
import { getFile, putFile, delFile } from "./src/idb.js";

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.mjs");

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ["from", "to", "k_tam", "k_qisa", "o_adoc", "o_merged", "o_excel", "o_invoys", "o_cmr", "o_diger", "o_musayiet", "folder"];
let stopFlag = false;

// ---------- ayarlar ----------
async function loadSettings() {
  const { cfg } = await chrome.storage.local.get("cfg");
  if (!cfg) return;
  for (const id of IDS) if (id in cfg) { const e = $(id); if (e.type === "checkbox") e.checked = cfg[id]; else e.value = (id === "from" || id === "to") ? isoToDmy(cfg[id]) : cfg[id]; }
}
// Tarix xanaları gün.ay.il (gg.aa.iiii) formatındadır; daxildə ISO (iiii-aa-gg) saxlanır
const isoToDmy = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : (v || ""); };
const dmyToIso = (v) => {
  const m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec((v || "").trim());
  if (!m) return "";
  const d = +m[1], mo = +m[2], y = +m[3], dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
};
const readCfg = () => Object.fromEntries(IDS.map((id) => [id, $(id).type === "checkbox" ? $(id).checked : (id === "from" || id === "to") ? dmyToIso($(id).value) : $(id).value]));
["from", "to"].forEach((id) => $(id).addEventListener("input", (ev) => {
  if (ev.inputType && ev.inputType.startsWith("delete")) return;
  const d = $(id).value.replace(/\D/g, "").slice(0, 8);
  $(id).value = d.length > 4 ? `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}.${d.slice(2)}` : d;
}));
IDS.forEach((id) => $(id).addEventListener("change", () => chrome.storage.local.set({ cfg: readCfg() })));
loadSettings();

// ---------- saxlama qovluğu (istifadəçinin seçdiyi qovluq) ----------
let dirHandle = null;
function showFolder() {
  const el = $("folderName");
  if (dirHandle) { el.textContent = "Seçilmiş qovluq: " + dirHandle.name; el.className = "ok"; }
  else { el.textContent = "Seçilmiş qovluq: yoxdur"; el.className = "mute"; }
}
async function loadHandle() { try { dirHandle = (await getFile("dirHandle")) || null; } catch (_) { dirHandle = null; } showFolder(); }
$("pick").onclick = async () => {
  try {
    const h = await window.showDirectoryPicker({ id: "gomruk", mode: "readwrite" });
    dirHandle = h; await putFile("dirHandle", h); showFolder();
  } catch (e) { if (e.name !== "AbortError") log("Qovluq seçilmədi: " + e.message); }
};
$("folder").addEventListener("input", showFolder);
async function ensureFolderAccess() {
  if (!dirHandle) return true;
  let p = await dirHandle.queryPermission({ mode: "readwrite" });
  if (p !== "granted") p = await dirHandle.requestPermission({ mode: "readwrite" });
  return p === "granted";
}
async function existsIn(dir, name) { try { await dir.getFileHandle(name); return true; } catch (e) { if (e.name === "NotFoundError") return false; throw e; } }
loadHandle();

// ---------- log ----------
const log = (m) => { $("log").textContent += m + "\n"; $("log").scrollTop = 1e9; };
const status = (m) => { $("status").textContent = m; };
const dmy = (iso) => iso.split("-").reverse().join(".");
// Portal 1 ildən uzun aralığı qəbul etmir: aralığı ≤360 günlük hissələrə bölürük
function chunks(fromIso, toIso) {
  const out = [], DAY = 86400000;
  let a = new Date(fromIso + "T00:00:00Z").getTime();
  const end = new Date(toIso + "T00:00:00Z").getTime();
  while (a <= end) {
    const b = Math.min(a + 364 * DAY, end);
    out.push([new Date(a).toISOString().slice(0, 10), new Date(b).toISOString().slice(0, 10)]);
    a = b + DAY;
  }
  return out;
}

// ---------- səhifə ilə əlaqə ----------
async function portalTab() {
  // Əvvəlcə panelin açıldığı pəncərədəki portal tabı, sonra digər pəncərələr
  const tabs = await chrome.tabs.query({ url: "*://*.customs.gov.az/*" });
  let win = null;
  try { win = await chrome.windows.getCurrent(); } catch (_) {}
  const rank = (t) => (win && t.windowId === win.id ? 0 : 2) + (t.active ? 0 : 1);
  return [...tabs].sort((x, y) => rank(x) - rank(y))[0];
}
async function drive(cmd, args = {}) {
  const tab = await portalTab();
  if (!tab) throw new Error("Gömrük saytı açıq deyil (e.customs.gov.az).");
  const send = () => new Promise((res) => chrome.tabs.sendMessage(tab.id, { target: "driver", cmd, args }, (x) => res(x ?? { error: chrome.runtime.lastError?.message || "cavab yoxdur" })));
  let r = await send();
  if (r && r.error && /Receiving end|Could not establish|cavab yoxdur/i.test(r.error)) {
    // Skript səhifəyə qoşulmayıb (səhifə uzantıdan əvvəl açılıb): özümüz yeridirik
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["driver.js"] });
      await new Promise((ok) => setTimeout(ok, 500));
      r = await send();
    } catch (e) { r = { error: "Skript yeridilmədi: " + e.message }; }
    if (r && r.error && /Receiving end|Could not establish|cavab yoxdur/i.test(r.error))
      r = { error: `Portalın siyahı səhifəsi (Gömrük bəyannaməsi) tapılmadı (tab ${tab.id}, pəncərə ${tab.windowId}). Həmin tabda siyahı açıq olmalıdır; səhifəni F5 ilə yeniləyin və yenidən cəhd edin.` };
  }
  if (r && r.error) throw new Error(r.error);
  return r;
}

// Səhifə dəyişəndən sonra (yeni səhifədə skript yenidən başlayır) hazır olanı gözləyir
async function waitPage(test, ms = 30000) {
  const tab = await portalTab();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (stopFlag) throw new Error("dayandırıldı");
    if (tab) {
      const r = await new Promise((res) => chrome.tabs.sendMessage(tab.id, { target: "driver", cmd: "ping", args: {} }, (x) => res(chrome.runtime.lastError ? null : x)));
      if (r && !r.error && test(r)) return r;
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error("səhifə gözlənilən vəziyyətə gəlmədi");
}

// Portalın siyahı səhifəsini özümüz açırıq (istifadəçi səhifəni açıb tarix seçməli olmasın)
const PORTAL_URL = "https://e.customs.gov.az/for-xif/egb-trader";
async function gotoList() {
  let tab = await portalTab();
  if (tab) await chrome.tabs.update(tab.id, { url: PORTAL_URL, active: true });
  else tab = await chrome.tabs.create({ url: PORTAL_URL, active: true });
  await new Promise((ok) => setTimeout(ok, 1500));
  try { await waitPage((x) => !x.hasStep1 && x.sel > 0, 45000); }
  catch (e) { throw new Error("Portalın siyahı səhifəsi açılmadı. Portala daxil olduğunuzu (ASAN imza) və səhifənin yükləndiyini yoxlayın."); }
}

// ---------- yükləmənin tutulması ----------
const waiters = new Map();
chrome.runtime.onMessage.addListener((m) => {
  if ((m.type === "captured" || m.type === "capture-failed") && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
});
let seq = 0;
async function capture(doClick, fallbackName) {
  const id = `f${Date.now()}_${++seq}`;
  const p = new Promise((res) => { waiters.set(id, res); setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); res({ type: "capture-failed", error: "vaxt bitdi" }); } }, 45000); });
  await chrome.runtime.sendMessage({ type: "expect", job: { id, fallbackName } });
  await doClick();
  const r = await p;
  if (r.type !== "captured") { await chrome.runtime.sendMessage({ type: "clearExpect" }); throw new Error("fayl alınmadı: " + (r.error || "") + (r.url ? " [" + r.url + "]" : "")); }
  const rec = await getFile(id);
  await delFile(id);
  return { bytes: new Uint8Array(rec.buf), type: rec.type, name: rec.name, disp: rec.disp };
}

// Əvvəl səhifənin öz POST sorğusu ilə birbaşa çəkir; alınmasa brauzer yükləməsini tutmağa keçir.
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function getFile2(fetchCmd, fetchArgs, clickCmd, clickArgs, fallbackName) {
  try {
    await chrome.runtime.sendMessage({ type: "busy", ms: 30000 });
    const r = await drive(fetchCmd, fetchArgs);
    return { bytes: unb64(r.b64), type: r.type, name: "", disp: r.disp };
  } catch (e) {
    log(`(birbaşa çəkmə alınmadı: ${e.message}; brauzer yükləməsi yoxlanılır)`);
    return capture(() => drive(clickCmd, clickArgs), fallbackName);
  }
}

// ---------- fayl saxlamaq ----------
async function save(bytes, name, mime = "application/octet-stream") {
  name = cleanName(name);
  if (dirHandle) {
    let n = name, i = 1;
    while (await existsIn(dirHandle, n)) n = name.replace(/(\.[^./]+)?$/, (m, ext) => ` (${++i})${ext || ""}`);
    const w = await (await dirHandle.getFileHandle(n, { create: true })).createWritable();
    await w.write(bytes); await w.close();
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const folder = cleanName($("folder").value || "Gomruk");
  await chrome.downloads.download({ url, filename: `${folder}/${name}`, conflictAction: "uniquify", saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function sniffExt(bytes, hint = "") {
  const h = [...bytes.slice(0, 4)].map((b) => String.fromCharCode(b)).join("");
  if (h.startsWith("%PDF")) return ".pdf";
  if (h.startsWith("Rar!")) return ".rar";
  if (h.startsWith("PK")) return /adoc/i.test(hint) ? ".adoc" : ".zip";
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(hint);
  return m ? "." + m[1].toLowerCase() : ".bin";
}

// ---------- əsas axın ----------
async function run() {
  if (!licensed) return alert("İcazə yoxdur: aktivləşdirmə kodu lazımdır.");
  if (!(await ensureFolderAccess())) return alert("Seçilmiş qovluğa yazmaq icazəsi verilmədi.");
  const cfg = readCfg();
  if (!cfg.from || !cfg.to) return alert("Tarixləri gün.ay.il formatında yazın (məs. 01.01.2025).");
  if (!cfg.k_tam && !cfg.k_qisa) return alert("Ən azı bir bəyannamə növü seçin.");
  const needAdoc = cfg.o_adoc || cfg.o_merged || cfg.o_excel;
  const extras = [cfg.o_invoys && "invoys", cfg.o_cmr && "cmr", cfg.o_diger && "diger", cfg.o_musayiet && "musayiet"].filter(Boolean);
  if (!needAdoc && !extras.length) return alert("Nə yüklənəcəyini seçin.");
  stopFlag = false; $("start").disabled = true; $("stop").disabled = false; $("log").textContent = "";
  if (cfg.from > cfg.to) return alert("Başlanğıc tarixi sonuncudan böyükdür.");
  const filtOf = {}; // gb -> həmin GB-nin tapıldığı filtr
  const pageOf = {}; // gb -> siyahıda olduğu səhifə nömrəsi
  // Canlı siyahıda ardıcıl Page$N postback-ləri ilə n-ci səhifəyə keçir (səhifənin öz dünyasında)
  async function toPage(n) {
    for (let p = 2; p <= n; p++) {
      const sig0 = (await drive("pageInfo")).sig;
      const pt = await drive("pageTarget", { n: p });
      let posted = false;
      try {
        const tab = await portalTab();
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true }, world: "MAIN",
          func: (t, a, n) => {
            try {
              if (!document.getElementById("__VIEWSTATE")) return "";
              // 1) səhifənin öz keçidinə səhifə dünyasında klik (href-i özü icra olunur)
              const links = [...document.querySelectorAll("a")].filter((x) => (x.textContent || "").trim() === String(n) && x.closest("table"));
              let lk = links.find((x) => /Page\$|__doPostBack/.test((x.getAttribute("href") || "") + (x.getAttribute("onclick") || ""))) || links[0];
              // 10-dan sonrakı səhifələrdə nömrə görünmür: növbəti qrupa "..." keçidi aparır (sonuncu "..." irəli keçiddir)
              if (!lk) { const dots = [...document.querySelectorAll("a")].filter((x) => /^\.{2,3}$|^…$/.test((x.textContent || "").trim()) && x.closest("table")); lk = dots[dots.length - 1]; }
              if (lk) { const h = (lk.getAttribute("href") || "").slice(0, 120); setTimeout(() => lk.click(), 50); return "klik:" + h; }
              // 2) birbaşa postback
              if (typeof __doPostBack === "function") { setTimeout(() => __doPostBack(t, a), 50); return "postback"; }
            } catch (e) { return "xəta:" + e.message; }
            return "";
          },
          args: [pt.t, pt.a, p],
        });
        const hit = res.map((x) => x.result).find((x) => x);
        posted = !!hit;
        if (hit) log(`Səhifə ${p}-ə keçid: ${hit}`);
      } catch (e) { log("MAIN keçid xətası: " + e.message); }
      if (!posted) await drive("gotoPage", { n: p });
      try { await waitPage((x) => x.list > 0 && x.sig && x.sig !== sig0, 25000); }
      catch (e) { throw new Error(`${p}-ci səhifəyə keçid alınmadı (keçid məlumatı: ${pt.raw || "yoxdur"}; ${pt.t} / ${pt.a}; usuluyyət: ${posted ? "səhifə dünyasında" : "klik"})`); }
    }
  }
  async function ensureRow(gb, force = false) {
    if (!force && (await drive("hasRow", { gb })).has) return;
    await gotoList(); // təzə siyahı: əvvəlki səhifələmə/axtarış vəziyyəti qalmasın
    await drive("applyFilters", filtOf[gb]);
    if ((await drive("hasRow", { gb })).has) return;
    await toPage(pageOf[gb] || 1);
    if (!(await drive("hasRow", { gb })).has) throw new Error(`GB siyahıda tapılmadı (səhifə ${pageOf[gb] || 1}): ${gb}`);
  }
  const results = [], release = {};
  try {
    status("Portal açılır…");
    await gotoList();
    status("Siyahı axtarılır…");
    const parts0 = chunks(cfg.from, cfg.to);
    if (parts0.length > 1) log(`Aralıq 1 ildən uzundur: ${parts0.length} hissəyə bölünür.`);
    const seen = new Map();
    let ci = 0;
    for (const [a, b] of parts0) {
      if (stopFlag) break;
      if (ci++ > 0) await gotoList(); // hər hissə təzə siyahı səhifəsindən başlayır (əvvəlki axtarışın vəziyyəti qalmasın)
      const f = { from: dmy(a), to: dmy(b), rep: "sahibkar" };
      const ar = await drive("applyFilters", f);
      if (ar && ar.error) { log(`${f.from}–${f.to}: ${ar.error}`); continue; }
      if (ar && ar.empty) { log(`${f.from}–${f.to}: bu aralıqda GB yoxdur${ar.msg ? " (" + ar.msg + ")" : ""}`); continue; }
      const k = (d) => { const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d || ""); return m ? m[3] + m[2] + m[1] : ""; };
      const take = (list, pn) => { for (const r of list) { const o = seen.get(r.gb); if (!o || k(r.op) > k(o.op)) { seen.set(r.gb, r); filtOf[r.gb] = f; pageOf[r.gb] = pn; } } };
      const la = await drive("listAll");
      for (const pg of la.pages) { take(pg.rows, pg.n); log(`${f.from}–${f.to}: səhifə ${pg.n}: ${pg.rows.length} sətir`); }
      if (la.err) log(`Səhifələmə dayandı: ${la.err}`);
      log(`${f.from}–${f.to}: cəmi ${seen.size}`);
    }
    const allList = [...seen.values()];
    log(`Siyahı (${allList.length}): ` + allList.map((r) => `${r.gb} [${r.tip}] ${r.op || "?"}`).join(" | "));
    let rows = allList.filter((r) => (r.tip === "tam" ? cfg.k_tam : cfg.k_qisa));
    if (rows.length !== allList.length) log(`Növə görə atılanlar (${cfg.k_tam ? "" : "tam "}${cfg.k_qisa ? "" : "qısa"} seçilməyib): ` + allList.filter((r) => !rows.includes(r)).map((r) => r.gb).join(", "));
    log(`Tapıldı: ${rows.length} bəyannamə.`);
    if (!rows.length) throw new Error("Seçilmiş aralıqda bəyannamə tapılmadı.");
    rows.forEach((r) => (release[r.gb] = r.op));
    const total = rows.length * ((needAdoc ? 1 : 0) + (extras.length ? 1 : 0));
    let done = 0; $("bar").hidden = false; $("bar").max = total; $("bar").value = 0;

    // 1) .adoc faylları (siyahıdan)
    if (needAdoc) for (const r of rows) {
      if (stopFlag) break;
      status(`.adoc: ${r.gb} (${++done}/${total})`); $("bar").value = done;
      const iso = isoDate(r.created);
      try {
        await ensureRow(r.gb);
        const f = await getFile2("fetchSignIcon", { gb: r.gb }, "clickSignIcon", { gb: r.gb }, `${iso}_${r.gb}`);
        const parts = await readAdoc(JSZip, f.bytes);
        if (cfg.o_adoc) await save(f.bytes, `${iso}_${r.gb}.adoc`);
        if (cfg.o_merged) { const m = await mergePdfs(PDFLib, parts.map((p) => p.bytes)); await save(m.bytes, `${iso}_${r.gb}.pdf`, "application/pdf"); log(`${r.gb}: ${parts.length} PDF → ${m.pages} səhifə`); }
        if (cfg.o_excel) {
          const files = [];
          for (const p of parts) files.push({ n: p.n, pages: await pdfPages(pdfjs, p.bytes) });
          results.push(parseDeclaration(files, r.gb));
        }
      } catch (e) { log(`XƏTA ${r.gb}: ${e.message}`); }
    }

    // 2) Excel
    if (cfg.o_excel && results.length && !stopFlag) {
      applyPrevValues(results);
      const xl = await buildXlsx(JSZip, buildSheets(results, release));
      await save(xl, `GB_terkib_${dmy(cfg.from)}_${dmy(cfg.to)}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      log(`Excel: ${results.length} bəyannamə.`);
    }

    // 3) Müşayiət sənədləri (hər GB açılır; hər dəfə siyahı sıfırlanır)
    if (extras.length) for (const r of rows) {
      if (stopFlag) break;
      status(`Müşayiət: ${r.gb} (${++done}/${total})`); $("bar").value = done;
      try {
        await ensureRow(r.gb, true);
        await drive("openGb", { gb: r.gb });
        await waitPage((x) => x.hasStep1);
        const labels = { invoys: "invoys", cmr: "CMR", diger: "digər sənədlər", musayiet: "əlavə sənədlər" };
        const grab = async (ex, list, mode) => {
          if (!list.length) { log(`${r.gb}: "${labels[ex]}" düyməsi yoxdur`); return; }
          for (const bt of list) {
            if (stopFlag) break;
            try {
              const f = await getFile2("fetchStep1", { label: ex, n: bt.n, mode }, "clickStep1", { label: ex, n: bt.n, mode }, `${r.gb} ${labels[ex]} ${bt.n}`);
              const ext = sniffExt(f.bytes, f.name || f.disp);
              await save(f.bytes, `${r.gb} ${labels[ex]} ${bt.n}${ext}`);
              log(`${r.gb}: ${labels[ex]} ${bt.n} yükləndi`);
            } catch (e) { log(`XƏTA ${r.gb} ${labels[ex]} ${bt.n}: ${e.message}`); }
          }
        };
        // a) ümumi səhifə: İnvoys / CMR / Digər sənədlər
        const gen = extras.filter((x) => x !== "musayiet");
        if (gen.length) {
          const st = await drive("openStep1");
          for (const ex of gen) await grab(ex, st.buttons.filter((b) => b.label === ex), "general");
        }
        // b) Yekun -> Addım 1: Müşayiət sənədləri (lupa)
        if (extras.includes("musayiet") && !stopFlag) {
          let ad;
          try {
            await drive("goYekun");
            await waitPage((x) => x.hasAddim1, 20000);
            const tab = await portalTab();
            const cr = await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true }, world: "MAIN",
              func: () => {
                try {
                  const a = [...document.querySelectorAll("a")].find((x) => /^Addım\s*1\b/i.test((x.textContent || "").trim()));
                  if (!a) return "";
                  const h = a.getAttribute("href") || "";
                  const m = /__doPostBack\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]/.exec(h);
                  if (m && typeof __doPostBack === "function") setTimeout(() => __doPostBack(m[1], m[2]), 50);
                  else setTimeout(() => a.click(), 50);
                  return "ok:" + h.slice(0, 100);
                } catch (e) { return ""; }
              },
            });
            const hit = cr.map((x) => x.result).find((x) => x);
            if (!hit) throw new Error("Addım 1 keçidi tapılmadı");
            await waitPage((x) => x.hasMus, 25000);
            ad = await drive("addimInfo");
          } catch (e) {
            let seen = "";
            try { seen = (await drive("yekunInfo")).join(" | "); } catch (_) {}
            throw new Error(`Müşayiət (Yekun/Addım 1) addımı alınmadı: ${e.message}. Səhifədə görünənlər: ${seen || "(oxunmadı)"}`);
          }
          await grab("musayiet", ad.buttons.filter((b) => b.label === "musayiet"), "addim");
        }
        await gotoList();
      } catch (e) { log(`XƏTA ${r.gb}: ${e.message}`); try { await gotoList(); } catch (_) {} }
    }
    status(stopFlag ? "Dayandırıldı." : "Bitdi.");
  } catch (e) { status("Xəta"); log(e.message); }
  $("start").disabled = false; $("stop").disabled = true;
}

$("start").onclick = run;
$("stop").onclick = () => { stopFlag = true; status("Dayandırılır…"); };
$("check").onclick = async () => {
  try { const r = await drive("ping"); log(`Sayt tapıldı (${r.host}). Siyahıda ${r.list} sətir. Addım bölməsi: ${r.hasStep1 ? "bəli" : "yox"}.`); } catch (e) { log("Yoxlama: " + e.message); }
};
$("diag").onclick = async () => {
  try { const r = await drive("inspect"); await save(new TextEncoder().encode(JSON.stringify(r, null, 1)), "diaqnostika.json", "application/json"); log("diaqnostika.json yükləndi."); } catch (e) { log("Diaqnostika: " + e.message); }
};

// ---------- yeniləmə yoxlaması (GitHub) ----------
(async () => {
  try {
    const REPO = "Aytac1999/K-m-k-i";
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const v = await r.json();
    const cur = chrome.runtime.getManifest().version;
    const num = (s) => String(s).split(".").map((x) => parseInt(x, 10) || 0);
    const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
    if (!v.version || !newer(v.version, cur)) return;
    const box = $("upd");
    box.innerHTML = "";
    box.append(`Yeni versiya var: ${v.version} (sizdə ${cur}). `);
    const b = document.createElement("button");
    b.textContent = "İndi yenilə"; b.className = "primary";
    b.onclick = () => selfUpdate(REPO, b, box);
    box.append(b);
    if (v.note) box.append(" — " + v.note);
    box.style.display = "block";
  } catch (_) {}
})();

// Extension qovluğunu GitHub-dakı son versiya ilə əvəz edir (qovluq bir dəfə seçilir) və extensionu yenidən yükləyir
async function selfUpdate(REPO, btn, box) {
  const msg = (t) => { btn.disabled = true; btn.textContent = t; };
  try {
    let h = null;
    try { h = (await getFile("extHandle")) || null; } catch (_) {}
    if (h) {
      let pm = await h.queryPermission({ mode: "readwrite" });
      if (pm !== "granted") pm = await h.requestPermission({ mode: "readwrite" });
      if (pm !== "granted") h = null;
    }
    if (!h) {
      alert("Extensionun qovluğunu seçin (içində manifest.json olan qovluq). Bu yalnız bir dəfə lazımdır.");
      h = await window.showDirectoryPicker({ mode: "readwrite", id: "gomruk-ext" });
      try { await h.getFileHandle("manifest.json"); } catch (_) { throw new Error("Seçilən qovluqda manifest.json yoxdur"); }
      await putFile("extHandle", h);
    }
    msg("Yüklənir…");
    const r = await fetch(`https://codeload.github.com/${REPO}/zip/refs/heads/main`, { cache: "no-store" });
    if (!r.ok) throw new Error("GitHub-dan yükləmə alınmadı (" + r.status + ")");
    const z = await JSZip.loadAsync(await r.arrayBuffer());
    const names = Object.keys(z.files).filter((n) => !z.files[n].dir);
    const top = names[0].split("/")[0] + "/";
    msg("Yazılır…");
    const put = async (rel, data) => {
      const parts = rel.split("/"); let d = h;
      for (const s of parts.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true });
      const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await w.write(data); await w.close();
    };
    for (const n of names) {
      const rel = n.slice(top.length);
      if (!rel || rel === "manifest.json" || rel.startsWith(".git")) continue;
      await put(rel, await z.files[n].async("uint8array"));
    }
    await put("manifest.json", await z.files[top + "manifest.json"].async("uint8array")); // ən axırda
    msg("Yeniləndi, yenidən başlayır…");
    setTimeout(() => chrome.runtime.reload(), 500);
  } catch (e) {
    btn.disabled = false; btn.textContent = "İndi yenilə";
    const s = document.createElement("div"); s.textContent = "Yeniləmə alınmadı: " + e.message; s.style.color = "#b91c1c"; box.append(s);
  }
}

// ---------- icazə yoxlaması (GitHub-dakı icazeler.json) ----------
let licensed = false;
const LIC_REPO = "Aytac1999/K-m-k-i";
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function myId() {
  let { devid } = await chrome.storage.local.get("devid");
  if (!devid) {
    const b = crypto.getRandomValues(new Uint8Array(5));
    const s = [...b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    devid = s.slice(0, 5) + "-" + s.slice(5);
    await chrome.storage.local.set({ devid });
  }
  return devid;
}
async function checkLicense(code) {
  const r = await fetch(`https://raw.githubusercontent.com/${LIC_REPO}/main/icazeler.json?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("net");
  const j = await r.json();
  const h = await sha256(code.trim());
  const u = (j.istifadeciler || []).find((x) => x.hash === h);
  if (!u) return { ok: false, why: "Kod tapılmadı və ya icazə verilməyib." };
  if (u.bitme && new Date(u.bitme + "T23:59:59") < new Date()) return { ok: false, why: "İcazənin müddəti bitib (" + u.bitme + ")." };
  return { ok: true, ad: u.ad, bitme: u.bitme || null };
}
(async () => {
  const lock = $("lock"), msg = $("lockMsg");
  const id = await myId();
  $("myid").textContent = id; $("lockId").textContent = id;
  $("myid").onclick = () => { navigator.clipboard.writeText(id).catch(() => {}); $("myid").textContent = "kopyalandı"; setTimeout(() => ($("myid").textContent = id), 1200); };
  const show = (t) => { if (t) msg.textContent = t; lock.style.display = "block"; licensed = false; $("start").disabled = true; };
  const ok = () => { lock.style.display = "none"; licensed = true; $("start").disabled = false; };
  const { lic } = await chrome.storage.local.get("lic");
  const codes = [id, lic && lic.code].filter(Boolean);
  let lastWhy = "", net = true;
  for (const c of codes) {
    try {
      const r = await checkLicense(c);
      if (r.ok) { await chrome.storage.local.set({ lic: { code: c, okAt: Date.now() } }); return ok(); }
      lastWhy = r.why;
    } catch (_) { net = false; }
  }
  if (!net) {
    if (lic && lic.okAt && Date.now() - lic.okAt < 3 * 864e5) return ok();
    show("İcazəni yoxlamaq üçün internet lazımdır.");
  } else show(lastWhy && /müddət/.test(lastWhy) ? lastWhy : "İcazə lazımdır. Aşağıdakı kodunuzu icazə verən şəxsə göndərin.");
  $("lockBtn").onclick = async () => {
    const code = $("lockCode").value.trim(); if (!code) return;
    try {
      const r = await checkLicense(code);
      if (!r.ok) return show(r.why);
      await chrome.storage.local.set({ lic: { code, okAt: Date.now() } });
      ok();
    } catch (_) { show("İnternetə qoşulub yenidən yoxlayın."); }
  };
})();
