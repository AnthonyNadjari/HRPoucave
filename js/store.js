// store.js — modèle de données + stockage dans un dépôt GitHub privé via l'API Contents.
// L'interface (app.js) ne parle qu'à ce module.
//
// Dépôt de données (privé) :
//   incidents.json          { format, updatedAt, incidents: [...] }
//   images/<id>.<ext>       capture originale
//   images/<id>.thumb.jpg   miniature (360 px)
//
// Incident :
// {
//   id, createdAt, updatedAt, source: 'manuel' | 'import',
//   date: 'AAAA-MM-JJ', time: 'HH:MM' | '',
//   context, category, impact: 'faible'|'modere'|'eleve'|'critique', impactNotes,
//   facts, quotes: [string], interpretation, witnesses: [string], tags: [string], evidenceNote,
//   attachments: [{ id, path, thumbPath, sha, thumbSha, name, type, size, width, height, addedAt, caption }]
// }

export const CATEGORIES = [
  'Propos dévalorisants', 'Humiliation publique', 'Pression / surcharge', 'Instructions contradictoires',
  'Mise à l\'écart', 'Rétention d\'information', 'Menace / intimidation', 'Discrimination', 'Congés / horaires', 'Autre'
];
export const IMPACTS = [
  { value: 'faible', label: 'Faible' }, { value: 'modere', label: 'Modéré' }, { value: 'eleve', label: 'Élevé' }, { value: 'critique', label: 'Critique' }
];

const DATA_FORMAT = 'carnet-incidents/data/1';
const DATA_FILE = 'incidents.json';
const CFG_KEY = 'carnet.config';
const CACHE_KEY = 'carnet.cache';

let config = null;          // { owner, repo, branch, token }
let incidents = new Map();
let dataSha = null;         // sha git de incidents.json (nécessaire pour écrire)
const blobCache = new Map(); // path -> object URL
const listeners = new Set();

function emit(type, payload) { listeners.forEach(fn => { try { fn(type, payload); } catch (e) { console.error(e); } }); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function uid() {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return Date.now().toString(36) + '-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// ---------- configuration ----------

export function getConfig() {
  if (config) return config;
  try { config = JSON.parse(localStorage.getItem(CFG_KEY)); } catch (_) { config = null; }
  return config;
}
export function isConnected() { return !!(config && config.token); }

export function parseRepo(text) {
  const m = String(text || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').match(/^([\w.-]+)\/([\w.-]+)\/?$/);
  if (!m) throw new Error('Dépôt attendu sous la forme utilisateur/nom.');
  return { owner: m[1], repo: m[2] };
}

export async function connect({ repo, token, branch = 'main' }) {
  const { owner, repo: name } = parseRepo(repo);
  const cfg = { owner, repo: name, branch, token: String(token || '').trim() };
  if (!cfg.token) throw new Error('Token manquant.');
  const r = await fetch(`${apiBase(cfg)}`, { headers: headers(cfg) });
  if (r.status === 401) throw new Error('Token refusé (401). Vérifiez qu\'il est bien copié et non expiré.');
  if (r.status === 404) throw new Error(`Dépôt ${owner}/${name} introuvable, ou token sans accès à ce dépôt.`);
  if (!r.ok) throw new Error(`GitHub a répondu ${r.status}.`);
  const info = await r.json();
  if (info.private === false) throw new Error('Ce dépôt est PUBLIC : refusé. Les fiches doivent aller dans un dépôt privé.');
  if (!info.permissions || !info.permissions.push) throw new Error('Le token ne permet pas d\'écrire dans ce dépôt (permission Contents : Read and write requise).');
  cfg.branch = branch || info.default_branch || 'main';
  config = cfg;
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  await load();
  emit('connected');
}

export function disconnect() {
  config = null; incidents = new Map(); dataSha = null;
  localStorage.removeItem(CFG_KEY); localStorage.removeItem(CACHE_KEY);
  for (const u of blobCache.values()) URL.revokeObjectURL(u);
  blobCache.clear();
  emit('disconnected');
}

// ---------- API GitHub ----------

function apiBase(cfg = config) { return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`; }
function headers(cfg = config, extra = {}) {
  return { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
}
function assertCfg() { if (!config || !config.token) throw new Error('Non connecté au dépôt.'); }

async function apiJSON(method, path, body) {
  assertCfg();
  const r = await fetch(`${apiBase()}/contents/${encodePath(path)}${method === 'GET' ? `?ref=${encodeURIComponent(config.branch)}&t=${Date.now()}` : ''}`, {
    method, headers: headers(config, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify({ branch: config.branch, ...body }) : undefined
  });
  if (r.status === 404 && method === 'GET') return null;
  if (!r.ok) {
    let msg = `GitHub ${r.status}`;
    try { const j = await r.json(); if (j.message) msg += ' : ' + j.message; } catch (_) {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r.json();
}
function encodePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

function b64encode(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function utf8ToB64(str) { return b64encode(new TextEncoder().encode(str)); }
function b64ToUtf8(b64) { const s = atob(b64.replace(/\n/g, '')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); }

// ---------- chargement / écriture de incidents.json ----------

export function cachedIncidents() {
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); return c && Array.isArray(c.incidents) ? c.incidents : []; } catch (_) { return []; }
}

export async function load() {
  assertCfg();
  const file = await apiJSON('GET', DATA_FILE);
  let list = [];
  if (file) {
    dataSha = file.sha;
    const text = file.content ? b64ToUtf8(file.content) : await (await fetch(file.download_url, { headers: headers() })).text();
    try { const parsed = JSON.parse(text); list = Array.isArray(parsed) ? parsed : (parsed.incidents || []); }
    catch (e) { throw new Error('incidents.json est illisible (JSON invalide). Corrigez-le dans le dépôt.'); }
  } else { dataSha = null; }
  incidents = new Map(list.map(x => normalizeIncident(x)).map(i => [i.id, i]));
  localStorage.setItem(CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), incidents: Array.from(incidents.values()) }));
  emit('changed');
  return incidents.size;
}

function serialize() {
  const list = Array.from(incidents.values()).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return JSON.stringify({ format: DATA_FORMAT, updatedAt: new Date().toISOString(), incidents: list }, null, 2) + '\n';
}

// Écrit incidents.json. En cas de conflit (fichier modifié ailleurs), recharge et ré-applique la mutation.
async function commitData(message, mutate) {
  assertCfg();
  for (let attempt = 0; attempt < 3; attempt++) {
    mutate();
    try {
      const res = await apiJSON('PUT', DATA_FILE, { message, content: utf8ToB64(serialize()), ...(dataSha ? { sha: dataSha } : {}) });
      dataSha = res.content.sha;
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), incidents: Array.from(incidents.values()) }));
      return;
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && attempt < 2) { await load(); continue; }
      throw e;
    }
  }
}

// ---------- incidents ----------

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
    attachments: Array.isArray(x.attachments) ? x.attachments.filter(a => a && typeof a === 'object' && a.path) : []
  };
}

export function listIncidents() {
  return Array.from(incidents.values()).sort((a, b) => (b.date + (b.time || '00:00')).localeCompare(a.date + (a.time || '00:00')) || b.createdAt.localeCompare(a.createdAt));
}
export function getIncident(id) { return incidents.get(id) || null; }

export async function saveIncident(data) {
  const prev = data.id ? incidents.get(data.id) : null;
  const inc = normalizeIncident({ ...(prev || {}), ...data, attachments: prev ? prev.attachments : (data.attachments || []), updatedAt: new Date().toISOString() });
  if (prev) inc.createdAt = prev.createdAt;
  await commitData(`${prev ? 'Modifie' : 'Ajoute'} fiche ${inc.date}`, () => { incidents.set(inc.id, inc); });
  emit('changed', inc.id);
  return inc;
}

export async function saveMany(list) {
  const incs = list.map(x => normalizeIncident(x));
  await commitData(`Importe ${incs.length} fiche(s)`, () => { incs.forEach(i => incidents.set(i.id, i)); });
  emit('changed');
  return incs;
}

export async function deleteIncident(id) {
  const inc = incidents.get(id);
  if (!inc) return;
  for (const a of inc.attachments) await deleteFile(a.path, a.sha).catch(e => console.warn('image non supprimée', a.path, e));
  for (const a of inc.attachments) if (a.thumbPath) await deleteFile(a.thumbPath, a.thumbSha).catch(() => {});
  await commitData(`Supprime fiche ${inc.date}`, () => { incidents.delete(id); });
  emit('changed', id);
}

// ---------- fichiers / pièces jointes ----------

async function putFile(path, bytes, message) {
  // Récupère le sha si le fichier existe déjà (écrasement), sinon création.
  let sha;
  try { const ex = await apiJSON('GET', path); if (ex) sha = ex.sha; } catch (_) {}
  const res = await apiJSON('PUT', path, { message, content: b64encode(bytes), ...(sha ? { sha } : {}) });
  return res.content.sha;
}
async function deleteFile(path, sha) {
  if (!sha) { const ex = await apiJSON('GET', path); if (!ex) return; sha = ex.sha; }
  await apiJSON('DELETE', path, { message: `Supprime ${path}`, sha });
}

async function makeThumb(blob, max = 360) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    return { thumb: new Uint8Array(await out.arrayBuffer()), width: bmp.width, height: bmp.height };
  } catch (_) { return { thumb: null, width: 0, height: 0 }; }
}

export async function addAttachment(incidentId, file, caption = '') {
  const inc = incidents.get(incidentId);
  if (!inc) throw new Error('Fiche introuvable.');
  if (!/^image\//.test(file.type)) throw new Error('Seules les images sont acceptées.');
  const id = uid();
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' })[file.type] || (file.name.split('.').pop() || 'bin').toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { thumb, width, height } = await makeThumb(file);
  const path = `images/${inc.date}_${id}.${ext}`;
  const sha = await putFile(path, bytes, `Ajoute capture ${file.name || path} (fiche ${inc.date})`);
  let thumbPath = null, thumbSha = null;
  if (thumb) { thumbPath = `images/${inc.date}_${id}.thumb.jpg`; thumbSha = await putFile(thumbPath, thumb, `Miniature ${path}`); }
  const meta = { id, path, thumbPath, sha, thumbSha, name: file.name || path, type: file.type, size: bytes.length, width, height, addedAt: new Date().toISOString(), caption };
  // La fiche ne référence l'image qu'une fois celle-ci réellement poussée.
  await commitData(`Lie capture à la fiche ${inc.date}`, () => { const cur = incidents.get(incidentId); cur.attachments = [...cur.attachments.filter(a => a.id !== id), meta]; cur.updatedAt = new Date().toISOString(); });
  emit('changed', incidentId);
  return meta;
}

export function listAttachments(incidentId) { const inc = incidents.get(incidentId); return inc ? inc.attachments : []; }
export function getAttachmentMeta(incidentId, id) { return listAttachments(incidentId).find(a => a.id === id) || null; }

export async function updateAttachmentCaption(incidentId, id, caption) {
  await commitData(`Légende capture (fiche ${incidents.get(incidentId).date})`, () => { const a = getAttachmentMeta(incidentId, id); if (a) a.caption = caption; });
  emit('changed', incidentId);
}

export async function removeAttachment(incidentId, id) {
  const a = getAttachmentMeta(incidentId, id);
  if (!a) return;
  await deleteFile(a.path, a.sha);
  if (a.thumbPath) await deleteFile(a.thumbPath, a.thumbSha).catch(() => {});
  for (const p of [a.path, a.thumbPath]) if (p && blobCache.has(p)) { URL.revokeObjectURL(blobCache.get(p)); blobCache.delete(p); }
  await commitData(`Retire capture (fiche ${incidents.get(incidentId).date})`, () => { const cur = incidents.get(incidentId); cur.attachments = cur.attachments.filter(x => x.id !== id); });
  emit('changed', incidentId);
}

// Télécharge un fichier du dépôt (contenu brut) → Blob
export async function getFileBlob(path, type = 'application/octet-stream') {
  assertCfg();
  const r = await fetch(`${apiBase()}/contents/${encodePath(path)}?ref=${encodeURIComponent(config.branch)}`, { headers: headers(config, { Accept: 'application/vnd.github.raw+json' }) });
  if (!r.ok) throw new Error(`Image introuvable (${r.status}) : ${path}`);
  return new Blob([await r.arrayBuffer()], { type });
}
export async function getFileURL(path, type) {
  if (blobCache.has(path)) return blobCache.get(path);
  const url = URL.createObjectURL(await getFileBlob(path, type));
  blobCache.set(path, url);
  return url;
}
export async function getThumbURL(a) { return getFileURL(a.thumbPath || a.path, a.thumbPath ? 'image/jpeg' : a.type); }
export async function getAttachmentBlob(a) { return getFileBlob(a.path, a.type); }

export function stats() {
  let attachments = 0, attachBytes = 0;
  for (const i of incidents.values()) for (const a of i.attachments) { attachments++; attachBytes += a.size || 0; }
  return { incidents: incidents.size, attachments, attachBytes };
}

export function exportPlainJSON() { return serialize(); }
