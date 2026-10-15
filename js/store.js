// store.js — modèle de données + glue chiffrement/IndexedDB.
// Seule couche qui manipule des données en clair. L'interface (app.js) ne parle qu'à ce module.
//
// Incident (en clair, en mémoire) :
// {
//   id, createdAt, updatedAt, source: 'manuel' | 'import',
//   date: 'AAAA-MM-JJ', time: 'HH:MM' | '',
//   context, category, impact: 'faible'|'modere'|'eleve'|'critique', impactNotes,
//   facts, quotes: [string], interpretation,
//   witnesses: [string], tags: [string], evidenceNote,
//   attachments: [attachmentId]
// }
// Pièce jointe (méta en clair) : { id, incidentId, name, type, size, width, height, addedAt, caption }

import * as db from './db.js';
import { deriveKey, encryptJSON, decryptJSON, encryptBytes, decryptBytes, randomBytes, toBase64, fromBase64, uid } from './crypto.js';

export const CATEGORIES = [
  'Propos dévalorisants',
  'Humiliation publique',
  'Pression / surcharge',
  'Instructions contradictoires',
  'Mise à l\'écart',
  'Rétention d\'information',
  'Menace / intimidation',
  'Discrimination',
  'Congés / horaires',
  'Autre'
];

export const IMPACTS = [
  { value: 'faible', label: 'Faible' },
  { value: 'modere', label: 'Modéré' },
  { value: 'eleve', label: 'Élevé' },
  { value: 'critique', label: 'Critique' }
];

const BACKUP_FORMAT = 'carnet-incidents/backup/1';
const CHECK_PLAINTEXT = 'carnet-incidents-ok';

let key = null;          // CryptoKey AES-GCM, en mémoire uniquement
let vaultMeta = null;    // { salt, check, createdAt, iterations }
let incidents = new Map();   // id -> incident en clair
let attachMeta = new Map();  // id -> méta en clair
const thumbURLs = new Map(); // id -> object URL (cache)
const listeners = new Set();

function emit(type, payload) { listeners.forEach(fn => { try { fn(type, payload); } catch (e) { console.error(e); } }); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------- état du coffre ----------

export async function status() {
  if (key) return 'unlocked';
  const meta = await db.get('meta', 'vault');
  vaultMeta = meta || null;
  return meta ? 'locked' : 'uninitialized';
}

export async function setup(passphrase) {
  if (await db.get('meta', 'vault')) throw new Error('Un coffre existe déjà.');
  const salt = randomBytes(16);
  const k = await deriveKey(passphrase, salt);
  const check = await encryptJSON(k, { v: CHECK_PLAINTEXT });
  vaultMeta = { id: 'vault', salt, check, createdAt: new Date().toISOString(), iterations: 310000 };
  await db.put('meta', vaultMeta);
  key = k;
  incidents = new Map();
  attachMeta = new Map();
  db.requestPersistence();
  emit('unlocked');
}

export async function unlock(passphrase) {
  const meta = await db.get('meta', 'vault');
  if (!meta) throw new Error('Aucun coffre.');
  const k = await deriveKey(passphrase, meta.salt);
  try {
    const c = await decryptJSON(k, meta.check);
    if (c.v !== CHECK_PLAINTEXT) throw new Error();
  } catch (_) {
    throw new Error('Phrase secrète incorrecte.');
  }
  key = k;
  vaultMeta = meta;
  await loadAll();
  db.requestPersistence();
  emit('unlocked');
}

export function lock() {
  key = null;
  incidents = new Map();
  attachMeta = new Map();
  for (const url of thumbURLs.values()) URL.revokeObjectURL(url);
  thumbURLs.clear();
  emit('locked');
}

export function isUnlocked() { return !!key; }

function assertKey() { if (!key) throw new Error('Coffre verrouillé.'); }

async function loadAll() {
  assertKey();
  incidents = new Map();
  attachMeta = new Map();
  const recs = await db.getAll('incidents');
  for (const r of recs) {
    try { incidents.set(r.id, normalizeIncident(await decryptJSON(key, r.data))); }
    catch (e) { console.error('Incident illisible', r.id, e); }
  }
  const atts = await db.getAll('attachments');
  for (const a of atts) {
    try { attachMeta.set(a.id, await decryptJSON(key, a.meta)); }
    catch (e) { console.error('Pièce jointe illisible', a.id, e); }
  }
}

export async function changePassphrase(oldPass, newPass) {
  assertKey();
  const meta = await db.get('meta', 'vault');
  const kOld = await deriveKey(oldPass, meta.salt);
  try { await decryptJSON(kOld, meta.check); } catch (_) { throw new Error('Ancienne phrase incorrecte.'); }
  const salt = randomBytes(16);
  const kNew = await deriveKey(newPass, salt);
  // Re-chiffrement de tout
  const incRecs = [];
  for (const inc of incidents.values()) incRecs.push({ id: inc.id, data: await encryptJSON(kNew, inc), updatedAt: inc.updatedAt });
  const attRecs = [];
  for (const a of await db.getAll('attachments')) {
    const m = await decryptJSON(key, a.meta);
    const blob = await decryptBytes(key, a.blob);
    const thumb = a.thumb ? await decryptBytes(key, a.thumb) : null;
    attRecs.push({ id: a.id, incidentId: a.incidentId, meta: await encryptJSON(kNew, m), blob: await encryptBytes(kNew, blob), thumb: thumb ? await encryptBytes(kNew, thumb) : null });
  }
  const check = await encryptJSON(kNew, { v: CHECK_PLAINTEXT });
  await db.putMany('incidents', incRecs);
  await db.putMany('attachments', attRecs);
  vaultMeta = { ...meta, salt, check };
  await db.put('meta', vaultMeta);
  key = kNew;
}

export async function wipeEverything() {
  lock();
  await db.clearAll();
  vaultMeta = null;
  emit('wiped');
}

// ---------- incidents ----------

export function normalizeIncident(x) {
  const arr = v => Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : (typeof v === 'string' && v.trim() ? v.split(/\n|;|,/).map(s => s.trim()).filter(Boolean) : []);
  const str = v => (v == null ? '' : String(v)).trim();
  const impact = ['faible', 'modere', 'eleve', 'critique'].includes(x.impact) ? x.impact : 'modere';
  return {
    id: x.id || uid(),
    createdAt: x.createdAt || new Date().toISOString(),
    updatedAt: x.updatedAt || new Date().toISOString(),
    source: x.source === 'import' ? 'import' : 'manuel',
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(x.date)) ? str(x.date) : new Date().toISOString().slice(0, 10),
    time: /^\d{2}:\d{2}$/.test(str(x.time)) ? str(x.time) : '',
    context: str(x.context),
    category: CATEGORIES.includes(x.category) ? x.category : (str(x.category) ? str(x.category) : 'Autre'),
    impact,
    impactNotes: str(x.impactNotes),
    facts: str(x.facts),
    quotes: arr(x.quotes),
    interpretation: str(x.interpretation),
    witnesses: arr(x.witnesses),
    tags: arr(x.tags),
    evidenceNote: str(x.evidenceNote),
    attachments: Array.isArray(x.attachments) ? x.attachments.filter(Boolean) : []
  };
}

export function listIncidents() {
  return Array.from(incidents.values()).sort((a, b) => (b.date + (b.time || '00:00')).localeCompare(a.date + (a.time || '00:00')) || b.createdAt.localeCompare(a.createdAt));
}

export function getIncident(id) { return incidents.get(id) || null; }

export async function saveIncident(data) {
  assertKey();
  const prev = data.id ? incidents.get(data.id) : null;
  const inc = normalizeIncident({ ...(prev || {}), ...data, updatedAt: new Date().toISOString() });
  if (prev) inc.createdAt = prev.createdAt;
  await db.put('incidents', { id: inc.id, data: await encryptJSON(key, inc), updatedAt: inc.updatedAt });
  incidents.set(inc.id, inc);
  emit('changed', inc.id);
  return inc;
}

export async function deleteIncident(id) {
  assertKey();
  const inc = incidents.get(id);
  if (!inc) return;
  for (const aid of inc.attachments) await removeAttachment(aid, true);
  await db.del('incidents', id);
  incidents.delete(id);
  emit('changed', id);
}

// ---------- pièces jointes ----------

async function makeThumb(blob, max = 360) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    return { thumb: new Uint8Array(await out.arrayBuffer()), width: bmp.width, height: bmp.height };
  } catch (_) {
    return { thumb: null, width: 0, height: 0 };
  }
}

export async function addAttachment(incidentId, file, caption = '') {
  assertKey();
  const inc = incidents.get(incidentId);
  if (!inc) throw new Error('Incident introuvable.');
  if (!/^image\//.test(file.type)) throw new Error('Seules les images sont acceptées.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { thumb, width, height } = await makeThumb(file);
  const meta = { id: uid(), incidentId, name: file.name || 'capture', type: file.type, size: bytes.length, width, height, addedAt: new Date().toISOString(), caption };
  const rec = {
    id: meta.id, incidentId,
    meta: await encryptJSON(key, meta),
    blob: await encryptBytes(key, bytes),
    thumb: thumb ? await encryptBytes(key, thumb) : null
  };
  await db.put('attachments', rec);
  attachMeta.set(meta.id, meta);
  // L'incident n'est considéré comme mis à jour qu'une fois la pièce réellement écrite.
  await saveIncident({ ...inc, attachments: [...inc.attachments, meta.id] });
  return meta;
}

export function getAttachmentMeta(id) { return attachMeta.get(id) || null; }

export function listAttachments(incidentId) {
  const inc = incidents.get(incidentId);
  if (!inc) return [];
  return inc.attachments.map(id => attachMeta.get(id)).filter(Boolean);
}

export async function updateAttachmentCaption(id, caption) {
  assertKey();
  const meta = attachMeta.get(id);
  const rec = await db.get('attachments', id);
  if (!meta || !rec) return;
  const next = { ...meta, caption };
  rec.meta = await encryptJSON(key, next);
  await db.put('attachments', rec);
  attachMeta.set(id, next);
  emit('changed', meta.incidentId);
}

export async function getAttachmentBlob(id) {
  assertKey();
  const rec = await db.get('attachments', id);
  const meta = attachMeta.get(id);
  if (!rec || !meta) throw new Error('Pièce jointe introuvable.');
  const bytes = await decryptBytes(key, rec.blob);
  return new Blob([bytes], { type: meta.type });
}

export async function getThumbURL(id) {
  assertKey();
  if (thumbURLs.has(id)) return thumbURLs.get(id);
  const rec = await db.get('attachments', id);
  const meta = attachMeta.get(id);
  if (!rec || !meta) return null;
  const bytes = rec.thumb ? await decryptBytes(key, rec.thumb) : await decryptBytes(key, rec.blob);
  const url = URL.createObjectURL(new Blob([bytes], { type: rec.thumb ? 'image/jpeg' : meta.type }));
  thumbURLs.set(id, url);
  return url;
}

export async function removeAttachment(id, skipIncidentUpdate = false) {
  assertKey();
  const meta = attachMeta.get(id);
  await db.del('attachments', id);
  attachMeta.delete(id);
  if (thumbURLs.has(id)) { URL.revokeObjectURL(thumbURLs.get(id)); thumbURLs.delete(id); }
  if (meta && !skipIncidentUpdate) {
    const inc = incidents.get(meta.incidentId);
    if (inc) await saveIncident({ ...inc, attachments: inc.attachments.filter(x => x !== id) });
  }
}

// ---------- préférences (non sensibles) ----------

export async function getPref(id, fallback = null) {
  const r = await db.get('prefs', id);
  return r ? r.value : fallback;
}
export async function setPref(id, value) { await db.put('prefs', { id, value }); }

export async function stats() {
  const est = await db.storageEstimate();
  let attachBytes = 0;
  for (const m of attachMeta.values()) attachBytes += m.size || 0;
  return { incidents: incidents.size, attachments: attachMeta.size, attachBytes, usage: est ? est.usage : null, quota: est ? est.quota : null };
}

// ---------- sauvegarde / restauration ----------
// Fichier .carnet : JSON { format, createdAt, salt(b64), iterations, payload(b64) }
// payload = chiffré avec la clé dérivée de la phrase secrète + salt du fichier.
// Contenu déchiffré : { incidents: [...], attachments: [{ meta, blob(b64), thumb(b64) }] }

export async function exportBackup() {
  assertKey();
  const atts = [];
  for (const a of await db.getAll('attachments')) {
    const meta = attachMeta.get(a.id);
    if (!meta) continue;
    atts.push({ meta, blob: toBase64(await decryptBytes(key, a.blob)), thumb: a.thumb ? toBase64(await decryptBytes(key, a.thumb)) : null });
  }
  const plain = { incidents: Array.from(incidents.values()), attachments: atts };
  const payload = await encryptJSON(key, plain);
  const file = { format: BACKUP_FORMAT, createdAt: new Date().toISOString(), salt: toBase64(vaultMeta.salt), iterations: vaultMeta.iterations || 310000, counts: { incidents: incidents.size, attachments: atts.length }, payload: toBase64(payload) };
  await setPref('lastBackupAt', file.createdAt);
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function readBackup(file, passphrase) {
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { throw new Error('Fichier illisible (JSON invalide).'); }
  if (parsed.format !== BACKUP_FORMAT) throw new Error('Format de sauvegarde non reconnu.');
  const salt = fromBase64(parsed.salt);
  const k = await deriveKey(passphrase, salt);
  let plain;
  try { plain = await decryptJSON(k, fromBase64(parsed.payload)); }
  catch (_) { throw new Error('Phrase secrète incorrecte pour cette sauvegarde.'); }
  return plain;
}

// mode : 'merge' (ajoute/écrase par id) ou 'replace' (vide le coffre d'abord)
export async function restoreBackup(plain, mode = 'merge') {
  assertKey();
  if (mode === 'replace') {
    await db.clearStore('incidents');
    await db.clearStore('attachments');
    incidents = new Map();
    attachMeta = new Map();
    for (const url of thumbURLs.values()) URL.revokeObjectURL(url);
    thumbURLs.clear();
  }
  let nInc = 0, nAtt = 0;
  const attRecs = [];
  for (const a of plain.attachments || []) {
    if (!a.meta || !a.meta.id || !a.blob) continue;
    attRecs.push({ id: a.meta.id, incidentId: a.meta.incidentId, meta: await encryptJSON(key, a.meta), blob: await encryptBytes(key, fromBase64(a.blob)), thumb: a.thumb ? await encryptBytes(key, fromBase64(a.thumb)) : null });
    attachMeta.set(a.meta.id, a.meta);
    nAtt++;
  }
  if (attRecs.length) await db.putMany('attachments', attRecs);
  const incRecs = [];
  for (const raw of plain.incidents || []) {
    const inc = normalizeIncident(raw);
    inc.attachments = inc.attachments.filter(id => attachMeta.has(id));
    incRecs.push({ id: inc.id, data: await encryptJSON(key, inc), updatedAt: inc.updatedAt });
    incidents.set(inc.id, inc);
    nInc++;
  }
  if (incRecs.length) await db.putMany('incidents', incRecs);
  emit('changed');
  return { incidents: nInc, attachments: nAtt };
}

// Export en clair (JSON) pour analyse / migration. À manipuler avec précaution.
export function exportPlainJSON() {
  assertKey();
  return JSON.stringify({ format: 'carnet-incidents/plain/1', exportedAt: new Date().toISOString(), incidents: Array.from(incidents.values()), attachments: Array.from(attachMeta.values()) }, null, 2);
}
