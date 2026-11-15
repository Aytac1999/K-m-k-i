// Background və panel arasında böyük faylları ötürmək üçün sadə IndexedDB.
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open("gomruk", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("files");
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction("files", mode);
    const rq = fn(t.objectStore("files"));
    t.oncomplete = () => res(rq?.result);
    t.onerror = () => rej(t.error);
  });
};
export const putFile = (key, val) => tx("readwrite", (s) => s.put(val, key));
export const getFile = (key) => tx("readonly", (s) => s.get(key));
export const delFile = (key) => tx("readwrite", (s) => s.delete(key));
