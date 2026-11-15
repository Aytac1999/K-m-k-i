// .adoc (ASiC zip konteyneri) içindən 1.pdf, 2.pdf, 3.pdf ... çıxarır və birləşdirir.
export async function readAdoc(JSZip, bytes) {
  const z = await JSZip.loadAsync(bytes);
  const found = [];
  z.forEach((path, f) => {
    const m = /(?:^|\/)(\d+)\.pdf$/i.exec(path);
    if (m && !f.dir) found.push({ n: parseInt(m[1], 10), f });
  });
  found.sort((a, b) => a.n - b.n);
  const out = [];
  for (const x of found) out.push({ n: x.n, bytes: await x.f.async("uint8array") });
  return out;
}

export async function mergePdfs(PDFLib, list) {
  const out = await PDFLib.PDFDocument.create();
  for (const b of list) {
    const src = await PDFLib.PDFDocument.load(b, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return { bytes: await out.save(), pages: out.getPageCount() };
}

export const isoDate = (dmy) => (dmy ? dmy.split(".").reverse().join("-") : "tarixsiz");
export const cleanName = (s) => String(s).replace(/[\\/:*?"<>|]/g, "-").trim();
