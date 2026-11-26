// Passphrase encryption for backups and the app-lock PIN hash, using only the browser's Web Crypto API (no libraries).
//   Backups: AES-256-GCM; key from the passphrase via PBKDF2-SHA-256 (600,000 iterations, 16-byte random salt);
//            a fresh 12-byte IV per file. GCM authenticates: a wrong passphrase or any change to the file fails.
//   PIN:     PBKDF2-SHA-256 (210,000 iterations, random salt) → 32 bytes, compared in constant time.
// Pure apart from crypto.getRandomValues / crypto.subtle (both in browsers and in Node 22): tests/secure.test.js.

export const ENCRYPTED_FORMAT = 'crux-encrypted';
export const BACKUP_ITERATIONS = 600_000;
export const PIN_ITERATIONS = 210_000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function aesKey(passphrase, salt, iterations) {
  const base = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** A passphrase must be at least 8 characters. Returns an error message, or null when it's acceptable. */
export function passphraseProblem(p) {
  if (typeof p !== 'string' || [...p].length < 8) return 'Use at least 8 characters.';
  if (/^(.)\1+$/.test(p)) return 'Don’t repeat one character.';
  return null;
}

/** Encrypt a backup's JSON text. Returns the envelope object to save as a .json file. */
export async function encryptBackup(plainText, passphrase, { iterations = BACKUP_ITERATIONS } = {}) {
  const salt = random(16);
  const iv = random(12);
  const key = await aesKey(passphrase, salt, iterations);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plainText));
  return {
    app: 'crux',
    format: ENCRYPTED_FORMAT,
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(data),
  };
}

/** True when a file's text is an encrypted CRUX backup (it then needs a passphrase before it can be read). */
export function isEncryptedBackup(text) {
  try {
    const o = JSON.parse(text);
    return !!o && o.app === 'crux' && o.format === ENCRYPTED_FORMAT;
  } catch {
    return false;
  }
}

export class WrongPassphrase extends Error {
  constructor() { super('That passphrase doesn’t open this file.'); this.name = 'WrongPassphrase'; }
}

/** Decrypt an encrypted backup's text with a passphrase. Throws WrongPassphrase (or a plain Error for a damaged file). */
export async function decryptBackup(text, passphrase) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('This file isn’t valid JSON.'); }
  const iterations = o?.kdf?.iterations;
  if (o?.format !== ENCRYPTED_FORMAT || o.v !== 1 || o.kdf?.name !== 'PBKDF2' || o.kdf?.hash !== 'SHA-256' || o.cipher?.name !== 'AES-GCM'
    || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 10_000_000 || typeof o.data !== 'string') {
    throw new Error('This encrypted backup is damaged or from an unknown version.');
  }
  let salt; let iv; let data;
  try { salt = fromB64(o.kdf.salt); iv = fromB64(o.cipher.iv); data = fromB64(o.data); } catch { throw new Error('This encrypted backup is damaged.'); }
  if (salt.length < 16 || iv.length !== 12) throw new Error('This encrypted backup is damaged.');
  const key = await aesKey(passphrase, salt, iterations);
  try {
    return dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv }, key, data));
  } catch {
    throw new WrongPassphrase(); // GCM can't tell a wrong passphrase from tampering: both mean "can't open"
  }
}

// ---------- PIN ----------
export const pinProblem = (pin) => (/^\d{4,8}$/.test(pin ?? '') ? (/^(\d)\1+$/.test(pin) ? 'Avoid one digit repeated.' : null) : 'Use 4 to 8 digits.');

async function pinBits(pin, salt, iterations) {
  const base = await subtle().importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256));
}

/** The record stored for an app lock: salt and hash only (never the PIN), plus its length for the keypad dots. */
export async function hashPin(pin, { iterations = PIN_ITERATIONS } = {}) {
  const salt = random(16);
  return { salt: toB64(salt), hash: toB64(await pinBits(pin, salt, iterations)), iterations, len: pin.length };
}

export async function verifyPin(pin, record) {
  if (!record || typeof pin !== 'string') return false;
  const got = await pinBits(pin, fromB64(record.salt), record.iterations);
  const want = fromB64(record.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i]; // constant time
  return diff === 0;
}

/**
 * Slow down guessing: no wait for the first 4 wrong PINs, then 30 s, doubling each time up to 5 minutes.
 * Returns milliseconds to wait after `fails` consecutive wrong attempts.
 */
export const lockoutMs = (fails) => (fails < 5 ? 0 : Math.min(300_000, 30_000 * 2 ** (fails - 5)));
