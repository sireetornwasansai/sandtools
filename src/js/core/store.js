// Local-only persistence: settings + recent activity in localStorage, documents in IndexedDB.
// Nothing here is ever sent to a server.

const SETTINGS_KEY = 'sand:settings';
const RECENT_KEY = 'sand:recent';
const DB_NAME = 'sand-db';
const DB_STORE = 'docs';
export const MAX_RECENT = 12;

/** @typedef {{theme:'light'|'dark'|'system',fontSize:number,tabSize:number,wordWrap:boolean,previewMode:'split'|'editor'|'preview',sidebarCollapsed:boolean,remoteImages:boolean}} Settings */
/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  theme: 'system', fontSize: 15, tabSize: 2, wordWrap: true,
  previewMode: 'split', sidebarCollapsed: false, remoteImages: false
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

/** @returns {Settings} */
export function getSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, readJSON(SETTINGS_KEY, {}));
  s.fontSize = clamp(Number(s.fontSize) || 15, 11, 28);
  s.tabSize = [2, 4, 8].includes(Number(s.tabSize)) ? Number(s.tabSize) : 2;
  return s;
}

/** @param {Partial<Settings>} patch */
export function setSettings(patch) {
  const next = Object.assign(getSettings(), patch);
  writeJSON(SETTINGS_KEY, next);
  window.dispatchEvent(new CustomEvent('sand:settings', { detail: next }));
  return next;
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ---------- Recent activity ---------- */
/** @typedef {{kind:'tool'|'file',id:string,label:string,path:string,ts:number}} RecentItem */
/** @returns {RecentItem[]} */
export function getRecent() {
  const list = readJSON(RECENT_KEY, []);
  return Array.isArray(list) ? list.filter((x) => x && typeof x.id === 'string') : [];
}
/** @param {Omit<RecentItem,'ts'>} item */
export function addRecent(item) {
  const list = getRecent().filter((x) => !(x.kind === item.kind && x.id === item.id));
  list.unshift({ ...item, ts: Date.now() });
  writeJSON(RECENT_KEY, list.slice(0, MAX_RECENT));
}
export function clearRecent() { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } }

/* ---------- Documents (IndexedDB) ---------- */
/** @typedef {{id:string,name:string,content:string,updated:number,size:number,eol?:'lf'|'crlf'}} DocRecord */
let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}
function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(DB_STORE, mode);
    const store = t.objectStore(DB_STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
export function newDocId() { return (crypto.randomUUID && crypto.randomUUID()) || `d${Date.now()}${Math.random().toString(16).slice(2)}`; }
/** @param {{id?:string,name:string,content:string,eol?:'lf'|'crlf'}} d @returns {Promise<DocRecord>} */
export async function saveDoc(d) {
  const rec = { id: d.id || newDocId(), name: d.name, content: d.content, eol: d.eol || 'lf', updated: Date.now(), size: new Blob([d.content]).size };
  await tx('readwrite', (s) => s.put(rec));
  return rec;
}
/** @returns {Promise<DocRecord|undefined>} */
export function getDoc(id) { return tx('readonly', (s) => s.get(id)); }
/** @returns {Promise<DocRecord[]>} */
export async function listDocs() {
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.updated - a.updated);
}
export function deleteDoc(id) { return tx('readwrite', (s) => s.delete(id)); }

/** Remove every piece of data this app stored in the browser. */
export async function clearAllLocalData() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('sand:')).forEach((k) => localStorage.removeItem(k));
    Object.keys(sessionStorage).filter((k) => k.startsWith('sand:')).forEach((k) => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
  try {
    const db = await openDb(); db.close(); dbPromise = null;
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve(undefined);
    });
  } catch { /* ignore */ }
}
