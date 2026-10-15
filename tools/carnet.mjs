#!/usr/bin/env node
// tools/carnet.mjs — publication des données chiffrées du carnet (utilisé par Claude).
//
// La clé n'est JAMAIS dans le dépôt. Elle est passée par la variable d'environnement
// CARNET_KEY (43 caractères base64url, la partie après « #k= » du lien d'accès).
//
//   node tools/carnet.mjs keygen                         nouvelle clé (à faire une seule fois)
//   node tools/carnet.mjs show                           affiche les fiches déchiffrées
//   node tools/carnet.mjs put <fiches.json>              remplace toutes les fiches ({ incidents: [...] })
//   node tools/carnet.mjs upsert <fiches.json>           ajoute / remplace par id
//   node tools/carnet.mjs img <fichier> <id>             chiffre une capture vers data/img/<id>.enc
//   node tools/carnet.mjs merge-drafts <brouillons.json> publie un export « Brouillons → Claude »
//   node tools/carnet.mjs get-img <id> <sortie>          déchiffre une capture
//
// Après chaque commande d'écriture : git add data && git commit -m "Mise à jour des données" && git push

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'incidents.enc');
const IMG = id => join(ROOT, 'data', 'img', `${id}.enc`);
const { subtle } = globalThis.crypto;

function b64url(bytes) { return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64url(s) { return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')); }

async function getKey() {
  const k = process.env.CARNET_KEY || '';
  const m = k.match(/([A-Za-z0-9_-]{43})$/);
  if (!m) { console.error('CARNET_KEY manquante ou invalide (attendu : la partie après #k= du lien).'); process.exit(2); }
  return subtle.importKey('raw', fromB64url(m[1]), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function enc(key, bytes) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function dec(key, packed) { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12))); }

async function readAll(key) {
  if (!existsSync(DATA)) return { incidents: [] };
  return JSON.parse(Buffer.from(await dec(key, new Uint8Array(readFileSync(DATA)))).toString('utf8'));
}
async function writeAll(key, incidents) {
  incidents.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const body = { format: 'carnet-incidents/data/1', updatedAt: new Date().toISOString(), incidents };
  mkdirSync(dirname(DATA), { recursive: true });
  writeFileSync(DATA, await enc(key, Buffer.from(JSON.stringify(body), 'utf8')));
  console.log(`data/incidents.enc : ${incidents.length} fiche(s)`);
}
function clean(inc, now) {
  const { draft, published, ...rest } = inc;
  rest.updatedAt = now; // ≥ date du brouillon : il sera retiré de l'appareil au prochain chargement
  rest.attachments = (rest.attachments || []).map(({ local, ...a }) => a);
  return rest;
}

const [cmd, ...args] = process.argv.slice(2);
const now = new Date().toISOString();
switch (cmd) {
  case 'keygen': {
    console.log(b64url(globalThis.crypto.getRandomValues(new Uint8Array(32))));
    break;
  }
  case 'show': {
    console.log(JSON.stringify(await readAll(await getKey()), null, 2));
    break;
  }
  case 'put': case 'upsert': {
    const key = await getKey();
    const input = JSON.parse(readFileSync(args[0], 'utf8'));
    const list = Array.isArray(input) ? input : input.incidents;
    if (!Array.isArray(list)) throw new Error('Attendu { incidents: [...] }');
    let incidents = cmd === 'put' ? [] : (await readAll(key)).incidents;
    const byId = new Map(incidents.map(i => [i.id, i]));
    for (const i of list) { if (!i.id) throw new Error('Chaque fiche doit avoir un id'); byId.set(i.id, clean(i, now)); }
    await writeAll(key, [...byId.values()]);
    break;
  }
  case 'img': {
    const key = await getKey();
    const [file, id] = args;
    if (!file || !/^[A-Za-z0-9_-]+$/.test(id || '')) throw new Error('usage : img <fichier> <id>');
    mkdirSync(dirname(IMG(id)), { recursive: true });
    writeFileSync(IMG(id), await enc(key, new Uint8Array(readFileSync(file))));
    console.log(`data/img/${id}.enc`);
    break;
  }
  case 'get-img': {
    const key = await getKey();
    writeFileSync(args[1], await dec(key, new Uint8Array(readFileSync(IMG(args[0])))));
    console.log(args[1]);
    break;
  }
  case 'merge-drafts': {
    const key = await getKey();
    const exp = JSON.parse(readFileSync(args[0], 'utf8'));
    const images = exp.images || {};
    const missing = [];
    for (const d of exp.incidents || []) for (const a of d.attachments || []) {
      if (!a.local) continue;
      if (images[a.id]) { writeFileSync(IMG(a.id), await enc(key, new Uint8Array(Buffer.from(images[a.id], 'base64')))); }
      else missing.push(a.id);
    }
    if (missing.length) { console.error('Images absentes de l\'export (utiliser « Télécharger avec les captures ») : ' + missing.join(', ')); process.exit(3); }
    const current = (await readAll(key)).incidents;
    const byId = new Map(current.map(i => [i.id, i]));
    for (const d of exp.incidents || []) byId.set(d.id, clean(d, now));
    await writeAll(key, [...byId.values()]);
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n'));
}
