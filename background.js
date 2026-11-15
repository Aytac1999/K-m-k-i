import { putFile } from "./src/idb.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

let expectJob = null;
let busyUntil = 0;             // bu vaxta qədər sayt "untitled" pəncərəsi açsa, bağlanır          // panel "indi bu fayl gələcək" deyir
const nameFor = new Map();     // yükləmə id -> ehtiyat ad

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "expect") { expectJob = { ...msg.job, ts: Date.now() }; busyUntil = Date.now() + 40000; reply({ ok: true }); }
  if (msg.type === "busy") { busyUntil = Date.now() + (msg.ms || 20000); reply({ ok: true }); }
  if (msg.type === "clearExpect") { expectJob = null; reply({ ok: true }); }
});

// Yükləmə başlayanda: faylı özümüz çəkib panelə veririk; alınmasa, brauzerin yükləməsi ehtiyat adla davam edir.
chrome.downloads.onCreated.addListener(async (item) => {
  if (!expectJob || Date.now() - expectJob.ts > 40000) return;
  const job = expectJob; expectJob = null;
  nameFor.set(item.id, job.fallbackName);
  const url = item.finalUrl || item.url;
  try {
    if (!/^https?:/.test(url)) throw new Error("fetch olunmayan ünvan: " + url.slice(0, 20));
    const r = await fetch(url, { credentials: "include" });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || /text\/html/i.test(type)) throw new Error(`cavab ${r.status} ${type}`);
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) throw new Error("boş cavab");
    await putFile(job.id, { buf, url, type, disp: r.headers.get("content-disposition") || "", name: item.filename });
    try { await chrome.downloads.cancel(item.id); await chrome.downloads.erase({ id: item.id }); } catch (_) {}
    chrome.runtime.sendMessage({ type: "captured", id: job.id, size: buf.byteLength }).catch(() => {});
  } catch (e) {
    chrome.runtime.sendMessage({ type: "capture-failed", id: job.id, error: String(e.message || e), url: url.slice(0, 200) }).catch(() => {});
  }
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const n = nameFor.get(item.id);
  if (n) {
    const ext = (item.filename.match(/\.[A-Za-z0-9]+$/) || [""])[0];
    suggest({ filename: `Gomruk/${n}${ext}`, conflictAction: "uniquify" });
  } else suggest();
});

// Sayt hər yükləmə üçün boş ("untitled") pəncərə/tab açır - iş zamanı onları avtomatik bağlayırıq.
chrome.tabs.onCreated.addListener((tab) => {
  if (Date.now() > busyUntil) return;
  const u = tab.pendingUrl || tab.url || "";
  if (tab.openerTabId === undefined && !/customs\.gov\.az|^about:blank$|^$/.test(u)) return;
  setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 1500);
});
