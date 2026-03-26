// ===== IndexedDB Handle Persistence =====

const DB_NAME = 'dashboardHandles';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHandle(key, handle) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(handle, key);
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
}

export async function getHandle(key) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).get(key);
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = reject; });
}

export async function verifyPermission(handle, write = false) {
  const opts = write ? { mode: 'readwrite' } : { mode: 'read' };
  if (await handle.queryPermission(opts) === 'granted') return true;
  if (await handle.requestPermission(opts) === 'granted') return true;
  return false;
}
