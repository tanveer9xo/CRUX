import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptBackup, decryptBackup, isEncryptedBackup, WrongPassphrase, passphraseProblem, hashPin, verifyPin, pinProblem, lockoutMs, toB64, fromB64,
} from '../js/secure.js';

const FAST = { iterations: 100_000 }; // the minimum the decryptor accepts; real files use 600,000

test('an encrypted backup round-trips exactly, including non-ASCII text', async () => {
  const plain = JSON.stringify({ app: 'crux', note: 'weekly veg ₹ नमस्ते', amounts: [125050, -50000] });
  const env = await encryptBackup(plain, 'correct horse battery', FAST);
  assert.equal(await decryptBackup(JSON.stringify(env), 'correct horse battery'), plain);
});

test('the encrypted file contains none of the plain data', async () => {
  const plain = JSON.stringify({ categories: [{ name: 'Groceries' }], entries: [{ amount: 125050, note: 'secret note' }] });
  const text = JSON.stringify(await encryptBackup(plain, 'passphrase-1', FAST));
  for (const s of ['Groceries', 'secret note', '125050']) assert.ok(!text.includes(s), s);
  assert.ok(isEncryptedBackup(text));
  assert.ok(!isEncryptedBackup(plain));
  assert.ok(!isEncryptedBackup('not json'));
});

test('the default strength is AES-256-GCM with PBKDF2-SHA-256 at 600,000 iterations', async () => {
  const env = await encryptBackup('{}', 'passphrase-1');
  assert.deepEqual([env.kdf.name, env.kdf.hash, env.kdf.iterations, env.cipher.name], ['PBKDF2', 'SHA-256', 600_000, 'AES-GCM']);
  assert.equal(fromB64(env.kdf.salt).length, 16);
  assert.equal(fromB64(env.cipher.iv).length, 12);
});

test('a fresh salt and IV each time: the same data and passphrase never give the same file', async () => {
  const a = await encryptBackup('{"x":1}', 'passphrase-1', FAST);
  const b = await encryptBackup('{"x":1}', 'passphrase-1', FAST);
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.notEqual(a.data, b.data);
});

test('a wrong passphrase fails cleanly', async () => {
  const text = JSON.stringify(await encryptBackup('{"x":1}', 'passphrase-1', FAST));
  await assert.rejects(decryptBackup(text, 'passphrase-2'), WrongPassphrase);
  await assert.rejects(decryptBackup(text, ''), WrongPassphrase);
});

test('any change to the file is detected (GCM authentication)', async () => {
  const env = await encryptBackup('{"x":1}', 'passphrase-1', FAST);
  const bytes = fromB64(env.data);
  bytes[0] ^= 1;
  await assert.rejects(decryptBackup(JSON.stringify({ ...env, data: toB64(bytes) }), 'passphrase-1'), WrongPassphrase);
});

test('damaged or weakened envelopes are refused before any decryption', async () => {
  const env = await encryptBackup('{"x":1}', 'passphrase-1', FAST);
  await assert.rejects(decryptBackup(JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 1000 } }), 'passphrase-1'), /damaged or from an unknown version/);
  await assert.rejects(decryptBackup(JSON.stringify({ ...env, cipher: { name: 'AES-CBC', iv: env.cipher.iv } }), 'passphrase-1'), /unknown version/);
  await assert.rejects(decryptBackup(JSON.stringify({ ...env, v: 2 }), 'passphrase-1'), /unknown version/);
  await assert.rejects(decryptBackup(JSON.stringify({ ...env, cipher: { ...env.cipher, iv: toB64(new Uint8Array(4)) } }), 'passphrase-1'), /damaged/);
  await assert.rejects(decryptBackup('{', 'x'), /valid JSON/);
});

test('passphrase rules: at least 8 characters, not one character repeated', () => {
  assert.equal(passphraseProblem('short'), 'Use at least 8 characters.');
  assert.equal(passphraseProblem('aaaaaaaa'), 'Don’t repeat one character.');
  assert.equal(passphraseProblem('monsoon tea 42'), null);
  assert.equal(passphraseProblem('पासवर्डपासवर्ड'), null); // counted as characters, not bytes
});

test('PIN: 4 to 8 digits, not one digit repeated; only a salted hash is kept', async () => {
  assert.equal(pinProblem('123'), 'Use 4 to 8 digits.');
  assert.equal(pinProblem('123456789'), 'Use 4 to 8 digits.');
  assert.equal(pinProblem('12a4'), 'Use 4 to 8 digits.');
  assert.equal(pinProblem('0000'), 'Avoid one digit repeated.');
  assert.equal(pinProblem('2468'), null);
  const rec = await hashPin('2468', FAST);
  assert.deepEqual(Object.keys(rec).sort(), ['hash', 'iterations', 'len', 'salt']);
  assert.ok(!JSON.stringify(rec).includes('2468'));
  assert.equal(rec.len, 4);
  assert.equal(await verifyPin('2468', rec), true);
  assert.equal(await verifyPin('2469', rec), false);
  assert.equal(await verifyPin('', rec), false);
  assert.equal(await verifyPin('2468', null), false);
  const again = await hashPin('2468', FAST);
  assert.notEqual(again.salt, rec.salt); // same PIN, different stored hash
  assert.notEqual(again.hash, rec.hash);
});

test('guessing slows down: free for 4 wrong PINs, then 30 s doubling to a 5-minute cap', () => {
  assert.deepEqual([0, 1, 4].map(lockoutMs), [0, 0, 0]);
  assert.deepEqual([5, 6, 7, 8, 9, 20].map(lockoutMs), [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
});
