// store.js — données du carnet.
//
// Source de vérité : le dépôt GitHub (servi par GitHub Pages), chiffré AES-GCM 256.
//   data/incidents.enc      [iv(12) | chiffré] de { format, updatedAt, incidents: [...] }
//   data/img/<id>.enc       [iv(12) | chiffré] des octets de l'image
// La clé (32 octets, base64url) n'est jamais dans le dépôt : elle arrive par le lien
// d'accès (#k=…), est retenue dans le navigateur, puis retirée de la barre d'adresse.
//
// Le site ne peut pas écrire sur GitHub (aucun identifiant). Ce qui est saisi dans
// l'application devient un BROUILLON local (IndexedDB), clairement signalé, qu'on envoie
// à Claude pour publication (tools/carnet.mjs merge-drafts). Un brouillon publié disparaît
// automatiquement au chargement suivant.

export const CATEGORIES = [
  'Propos dévalorisants', 'Humiliation publique', 'Pression / surcharge', 'Instructions contradictoires',
  'Mise à l\'écart', 'Rétention d\'information', 'Menace / intimidation', 'Discrimination', 'Congés / horaires', 'Autre'
];
export const IMPACTS = [
  { value: 'faible', label: 'Faible' }, { value: 'modere', label: 'Modéré' }, { value: 'eleve', label: 'Élevé' }, { value: 'critique', label: 'Critique' }
];

const KEY_LS = 'carnet.key.v1';
let key = null;
let remote = new Map();
let drafts = new Map();
let publishedAt = null;
let loaded = false;
const urlCache = new Map();
const listeners = new Set();
function emit(type, payload) { listeners.forEach(fn => { try { fn(type, payload); } catch (e) { console.error(e); } }); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function uid() {
  const b = new Uint8Array(6); crypto.getRandomValues(b);
  return Date.now().toString(36) + '-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// ---------- clé ----------

function b64urlToBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function bytesToB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
const KEY_RE = /(?:^|[#&?])k=([A-Za-z0-9_-]{43})/;

function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

async function useKey(k) { key = await crypto.subtle.importKey('raw', b64urlToBytes(k), 'AES-GCM', false, ['decrypt']); }

// Lit la clé dans le lien (puis l'efface de la barre d'adresse) ou dans la mémoire du navigateur.
export async function init() {
  const m = location.hash.match(KEY_RE);
  if (m) {
    lsSet(KEY_LS, m[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const k = (m && m[1]) || lsGet(KEY_LS);
  if (!k) return false;
  await useKey(k);
  return true;
}
export async function setKeyFromLink(text) {
  const m = String(text || '').match(KEY_RE);
  if (!m) throw new Error('Ce lien ne contient pas de clé d\'accès (#k=…).');
  await useKey(m[1]);
  lsSet(KEY_LS, m[1]);
}
export function forgetKey() { lsDel(KEY_LS); key = null; remote = new Map(); loaded = false; }
export function hasKey() { return !!key; }
export function isLoaded() { return loaded; }
export function getPublishedAt() { return publishedAt; }

async function decrypt(packed) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12)));
}
async function fetchEncrypted(path) {
  const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ---------- brouillons locaux (IndexedDB) ----------

let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise((res, rej) => {
    const q = indexedDB.open('carnet-brouillons', 1);
    q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('drafts', { keyPath: 'id' }); d.createObjectStore('images', { keyPath: 'id' }); };
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  return idbP;
}
async function idbReq(store, mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Écriture locale annulée'));
  });
}
const idbAll = s => idbReq(s, 'readonly', st => st.getAll());
const idbGet = (s, id) => idbReq(s, 'readonly', st => st.get(id));
const idbPut = (s, v) => idbReq(s, 'readwrite', st => st.put(v));
const idbDel = (s, id) => idbReq(s, 'readwrite', st => st.delete(id));

// ---------- chargement ----------

export async function load() {
  if (!key) throw new Error('Lien d\'accès manquant.');
  let list = [];
  const buf = await fetchEncrypted('data/incidents.enc');
  if (buf) {
    let plain;
    try { plain = await decrypt(buf); } catch (_) { throw new Error('Ce lien d\'accès ne correspond pas aux données publiées.'); }
    const d = JSON.parse(new TextDecoder().decode(plain));
    list = d.incidents || []; publishedAt = d.updatedAt || null;
  }
  remote = new Map(list.map(normalizeIncident).map(i => [i.id, i]));
  await loadDrafts(true);
  loaded = true;
  emit('changed');
  return remote.size;
}

async function loadDrafts(purge) {
  let all = [];
  try { all = await idbAll('drafts'); } catch (e) { console.warn('brouillons indisponibles', e); }
  drafts = new Map(all.map(d => [d.id, normalizeIncident(d)]));
  if (!purge) return;
  // Un brouillon publié par Claude (même id, version GitHub au moins aussi récente) est retiré.
  for (const d of Array.from(drafts.values())) {
    const r = remote.get(d.id);
    if (r && r.updatedAt >= d.updatedAt) {
      for (const a of d.attachments) if (a.local) await idbDel('images', a.id).catch(() => {});
      await idbDel('drafts', d.id).catch(() => {});
      drafts.delete(d.id);
    }
  }
}

// ---------- modèle ----------

export function normalizeIncident(x) {
  const arr = v => Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : (typeof v === 'string' && v.trim() ? v.split(/\n|;|,/).map(s => s.trim()).filter(Boolean) : []);
  const str = v => (v == null ? '' : String(v)).trim();
  return {
    id: x.id || uid(),
    createdAt: x.createdAt || new Date().toISOString(),
    updatedAt: x.updatedAt || new Date().toISOString(),
    source: x.source === 'import' ? 'import' : 'manuel',
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(x.date)) ? str(x.date) : new Date().toISOString().slice(0, 10),
    time: /^\d{2}:\d{2}$/.test(str(x.time)) ? str(x.time) : '',
    // Date à laquelle la discussion a eu lieu ou la preuve a été produite, si différente de l'événement.
    evidenceDate: /^\d{4}-\d{2}-\d{2}$/.test(str(x.evidenceDate)) ? str(x.evidenceDate) : '',
    evidenceTime: /^\d{2}:\d{2}$/.test(str(x.evidenceTime)) ? str(x.evidenceTime) : '',
    context: str(x.context),
    category: str(x.category) || 'Autre',
    impact: ['faible', 'modere', 'eleve', 'critique'].includes(x.impact) ? x.impact : 'modere',
    impactNotes: str(x.impactNotes),
    facts: str(x.facts),
    quotes: arr(x.quotes),
    interpretation: str(x.interpretation),
    witnesses: arr(x.witnesses),
    tags: arr(x.tags),
    evidenceNote: str(x.evidenceNote),
    attachments: Array.isArray(x.attachments) ? x.attachments.filter(a => a && typeof a === 'object' && a.id) : []
  };
}

function merged(id) {
  const d = drafts.get(id), r = remote.get(id);
  if (d) return { ...d, draft: true, published: !!r };
  if (r) return { ...r, draft: false, published: true };
  return null;
}
export function listIncidents() {
  const ids = new Set([...remote.keys(), ...drafts.keys()]);
  return Array.from(ids, merged).filter(Boolean)
    .sort((a, b) => (b.date + (b.time || '00:00')).localeCompare(a.date + (a.time || '00:00')) || b.createdAt.localeCompare(a.createdAt));
}
export function getIncident(id) { return merged(id); }
export function listAttachments(id) { const i = merged(id); return i ? i.attachments : []; }
export function draftCount() { return drafts.size; }

function strip(inc) { const { draft, published, ...rest } = inc; return rest; }

async function writeDraft(inc) {
  const clean = normalizeIncident(strip(inc));
  await idbPut('drafts', clean);
  drafts.set(clean.id, clean);
  emit('changed', clean.id);
  return merged(clean.id);
}
async function ensureDraft(id) {
  if (drafts.has(id)) return drafts.get(id);
  const r = remote.get(id); if (!r) throw new Error('Fiche introuvable.');
  return { ...r };
}

export async function saveIncident(data) {
  const prev = data.id ? merged(data.id) : null;
  const inc = { ...(prev ? strip(prev) : {}), ...data, attachments: prev ? prev.attachments : [], updatedAt: new Date().toISOString() };
  if (prev) inc.createdAt = prev.createdAt;
  return writeDraft(inc);
}
export async function saveMany(list) {
  const out = [];
  for (const x of list) out.push(await writeDraft({ ...normalizeIncident(x), updatedAt: new Date().toISOString() }));
  return out;
}
// Supprime le brouillon (et ses captures locales). Une fiche publiée redevient visible telle que sur GitHub.
export async function discardDraft(id) {
  const d = drafts.get(id); if (!d) return;
  for (const a of d.attachments) if (a.local) await idbDel('images', a.id).catch(() => {});
  await idbDel('drafts', id);
  drafts.delete(id);
  emit('changed', id);
}

async function makeThumb(blob, max = 360) {
  try {
    const bmp = await createImageBitmap(blob);
    return { width: bmp.width, height: bmp.height };
  } catch (_) { return { width: 0, height: 0 }; }
}
export async function addAttachment(incidentId, file) {
  if (!/^image\//.test(file.type)) throw new Error('Seules les images sont acceptées.');
  const base = await ensureDraft(incidentId);
  const id = uid();
  const { width, height } = await makeThumb(file);
  await idbPut('images', { id, blob: file });
  const meta = { id, local: true, name: file.name || 'capture', type: file.type, size: file.size, width, height, addedAt: new Date().toISOString(), caption: '' };
  await writeDraft({ ...base, attachments: [...base.attachments, meta], updatedAt: new Date().toISOString() });
  return meta;
}
export async function updateAttachmentCaption(incidentId, id, caption) {
  const base = await ensureDraft(incidentId);
  await writeDraft({ ...base, attachments: base.attachments.map(a => a.id === id ? { ...a, caption } : a), updatedAt: new Date().toISOString() });
}
export async function removeAttachment(incidentId, id) {
  const base = await ensureDraft(incidentId);
  const a = base.attachments.find(x => x.id === id);
  if (!a || !a.local) throw new Error('Une capture publiée ne peut être retirée que par Claude.');
  await writeDraft({ ...base, attachments: base.attachments.filter(x => x.id !== id), updatedAt: new Date().toISOString() });
  await idbDel('images', id).catch(() => {});
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
}

// ---------- images ----------

async function remoteImage(id, type) {
  const buf = await fetchEncrypted(`data/img/${id}.enc`);
  if (!buf) throw new Error('Capture introuvable sur GitHub.');
  return new Blob([await decrypt(buf)], { type });
}
export async function getAttachmentBlob(a) {
  if (a.local) { const r = await idbGet('images', a.id); if (!r) throw new Error('Capture locale introuvable.'); return r.blob; }
  return remoteImage(a.id, a.type);
}
export async function getThumbURL(a) {
  const k = a.local ? a.id : (a.thumbId || a.id);
  if (urlCache.has(k)) return urlCache.get(k);
  const blob = a.local ? await getAttachmentBlob(a) : await remoteImage(k, a.thumbId ? 'image/jpeg' : a.type);
  const url = URL.createObjectURL(blob);
  urlCache.set(k, url);
  return url;
}

// ---------- export pour Claude ----------

export async function exportDrafts(withImages) {
  const list = Array.from(drafts.values());
  const images = {};
  if (withImages) {
    for (const d of list) for (const a of d.attachments) if (a.local) {
      const r = await idbGet('images', a.id).catch(() => null);
      if (r) images[a.id] = bytesToB64(new Uint8Array(await r.blob.arrayBuffer()));
    }
  }
  return JSON.stringify({ format: 'carnet-incidents/drafts/1', exportedAt: new Date().toISOString(), incidents: list, ...(withImages ? { images } : {}) }, null, withImages ? 0 : 2);
}

export function stats() {
  let attachments = 0, attachBytes = 0, local = 0;
  for (const i of listIncidents()) for (const a of i.attachments) { attachments++; attachBytes += a.size || 0; if (a.local) local++; }
  return { incidents: listIncidents().length, published: remote.size, drafts: drafts.size, attachments, attachBytes, local, publishedAt };
}
export function exportPlainJSON() { return JSON.stringify({ format: 'carnet-incidents/plain/1', exportedAt: new Date().toISOString(), incidents: listIncidents().map(strip) }, null, 2); }
