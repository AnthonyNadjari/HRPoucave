// crypto.js — chiffrement au repos (WebCrypto).
// Tout ce qui est écrit dans IndexedDB passe par ici. La clé n'existe qu'en mémoire,
// dérivée de la phrase secrète (PBKDF2-SHA256) ; elle n'est jamais persistée.

const PBKDF2_ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Chiffre un ArrayBuffer/Uint8Array -> Uint8Array [iv(12) | ciphertext]
export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key, packed) {
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

export async function encryptJSON(key, obj) {
  return encryptBytes(key, enc.encode(JSON.stringify(obj)));
}

export async function decryptJSON(key, packed) {
  return JSON.parse(dec.decode(await decryptBytes(key, packed)));
}

export function toBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function uid() {
  const b = randomBytes(10);
  return Date.now().toString(36) + '-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
