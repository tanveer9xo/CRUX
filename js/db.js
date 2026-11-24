// IndexedDB access. One database, "crux" (VANE shares this github.io origin, so every name CRUX
// stores under starts with "crux": this database, localStorage keys, and the service worker's caches).
//   categories  { id, name, emoji, color, order, archived, createdAt }
//   budgets     { month: "YYYY-MM", plan: { categoryId: paise } }
//   entries     { id, amount (paise), categoryId, date "YYYY-MM-DD", note, createdAt, updatedAt }
//   meta        { key, value }   (lastExport, seeded, schema)
import { SCHEMA_VERSION } from './version.js';

export const DB_NAME = 'crux';
const STORES = ['categories', 'budgets', 'entries', 'meta'];
let dbp = null;

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('Transaction aborted')); });

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('budgets')) db.createObjectStore('budgets', { keyPath: 'month' });
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close(); // a newer tab is upgrading: let it
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('CRUX is open in another tab with an older version. Close it and reload.'));
  });
  return dbp;
}

export async function getAll(store) {
  const db = await openDB();
  return req2p(db.transaction(store).objectStore(store).getAll());
}

export async function put(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

/** Several writes across stores in one transaction: all or nothing. ops: [{ store, put } | { store, del }] */
export async function write(ops) {
  const db = await openDB();
  const tx = db.transaction([...new Set(ops.map((o) => o.store))], 'readwrite');
  for (const o of ops) {
    const s = tx.objectStore(o.store);
    if ('del' in o) s.delete(o.del);
    else s.put(o.put);
  }
  return done(tx);
}

export async function getMeta(key) {
  const db = await openDB();
  return (await req2p(db.transaction('meta').objectStore('meta').get(key)))?.value;
}

export const setMeta = (key, value) => put('meta', { key, value });

/** Replace all data in one transaction (import / erase). Meta keys in `keepMeta` survive. */
export async function replaceAll({ categories, budgets, entries }, meta = {}) {
  const db = await openDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of ['categories', 'budgets', 'entries']) tx.objectStore(s).clear();
  for (const c of categories) tx.objectStore('categories').put(c);
  for (const [month, plan] of Object.entries(budgets)) tx.objectStore('budgets').put({ month, plan });
  for (const e of entries) tx.objectStore('entries').put(e);
  for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
  return done(tx);
}
