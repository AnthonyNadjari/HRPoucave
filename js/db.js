// db.js — accès IndexedDB brut. Ne connaît rien au chiffrement :
// il stocke des enregistrements opaques (Uint8Array) produits par store.js.
//
// Stores :
//   meta        { id: 'vault', salt, check, createdAt, iterations }
//   incidents   { id, data: Uint8Array(chiffré), updatedAt }
//   attachments { id, incidentId, meta: Uint8Array(chiffré), blob: Uint8Array(chiffré), thumb: Uint8Array(chiffré) }
//   prefs       { id, value }   (non sensible : thème, délai de verrouillage, date de dernière sauvegarde)

const DB_NAME = 'carnet-incidents';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('incidents')) db.createObjectStore('incidents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('attachments')) {
        const s = db.createObjectStore('attachments', { keyPath: 'id' });
        s.createIndex('byIncident', 'incidentId', { unique: false });
      }
      if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet.'));
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée'));
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, id) {
  const db = await openDB();
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).get(id));
}

export async function getAll(store) {
  const db = await openDB();
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function getAllByIndex(store, index, value) {
  const db = await openDB();
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).index(index).getAll(value));
}

export async function put(store, record) {
  const db = await openDB();
  return tx(db, store, 'readwrite', s => s.put(record));
}

export async function putMany(store, records) {
  const db = await openDB();
  return tx(db, store, 'readwrite', s => { records.forEach(r => s.put(r)); });
}

export async function del(store, id) {
  const db = await openDB();
  return tx(db, store, 'readwrite', s => s.delete(id));
}

export async function clearStore(store) {
  const db = await openDB();
  return tx(db, store, 'readwrite', s => s.clear());
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['meta', 'incidents', 'attachments', 'prefs'], 'readwrite');
    ['meta', 'incidents', 'attachments', 'prefs'].forEach(n => t.objectStore(n).clear());
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch (_) { /* ignore */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (_) { /* ignore */ }
  return null;
}
