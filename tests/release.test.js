// Release hygiene: version bumps, the precache list, storage names on the shared github.io origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../js/version.js';
import { precacheList } from '../tools/build-site.mjs';
import { splashHTML, markSVG } from '../js/brand.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((f) => (statSync(join(ROOT, dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

test('service worker VERSION matches APP_VERSION and package.json', () => {
  assert.match(read('sw.js'), new RegExp(`const VERSION = '${APP_VERSION.replace(/\./g, '\\.')}';`));
  assert.equal(JSON.parse(read('package.json')).version, APP_VERSION);
});

test('the service worker precaches every app file (so the app works fully offline)', () => {
  const listed = new Set(precacheList());
  const files = [...walk('js'), ...walk('css'), ...walk('icons').filter((f) => /\.(png|svg)$/.test(f)), 'index.html', 'manifest.webmanifest'];
  for (const f of files) assert.ok(listed.has(f), `${f} is not in sw.js ASSETS`);
});

test('every storage name starts with "crux" (VANE shares the github.io origin)', () => {
  const src = walk('js').map((f) => read(f)).join('\n') + read('sw.js');
  assert.match(read('js/db.js'), /export const DB_NAME = 'crux';/);
  for (const m of src.matchAll(/(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['"`]([^'"`]+)/g)) {
    assert.ok(m[1].startsWith('crux'), `storage key "${m[1]}" must start with "crux"`);
  }
  for (const m of src.matchAll(/indexedDB\.open\(\s*([^,)]+)/g)) assert.equal(m[1].trim(), 'DB_NAME');
  assert.match(read('sw.js'), /const PREFIX = 'crux-';/);
  assert.match(read('sw.js'), /key\.startsWith\(PREFIX\)/, 'the service worker must only delete its own caches');
});

test('nothing in the app can wipe more than CRUX’s own data (VANE shares the origin)', () => {
  const files = [...walk('js'), 'sw.js'];
  const src = files.map((f) => read(f)).join('\n');
  // Broad wipes would also destroy VANE's data.
  assert.doesNotMatch(src, /localStorage\.clear|sessionStorage\.clear|indexedDB\.databases|Clear-Site-Data/);
  assert.doesNotMatch(read('js/pwa.js') + read('js/store.js') + read('js/db.js') + walk('js/views').map((f) => read(f)).join(''), /caches\.(?:delete|keys)/);
  // Deleting a database is only ever by the constant name "crux".
  for (const m of src.matchAll(/deleteDatabase\(\s*([^)]*)\)/g)) assert.equal(m[1].trim(), 'DB_NAME');
  // The reset removes only crux-prefixed localStorage keys, and writes only through the crux database module.
  const store = read('js/store.js');
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // ignore comments
  const reset = code(store.slice(store.indexOf('function clearCruxLocalStorage'), store.indexOf('export async function eraseAll')));
  assert.match(reset, /k\.startsWith\('crux'\)/);
  assert.match(reset, /db\.replaceAll\(/);
  assert.doesNotMatch(reset, /indexedDB|caches|fetch|sessionStorage/);
  // Every removeItem in the app is guarded the same way.
  for (const m of src.matchAll(/localStorage\.removeItem\(([^)]*)\)/g)) assert.equal(m[1].trim(), 'k');
});

test('no network calls or third-party hosts in the app', () => {
  const src = walk('js').map((f) => read(f)).join('\n') + read('index.html') + read('css/app.css');
  assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\/(?!www\.w3\.org)/);
});

test('the splash in index.html matches the brand mark, and icon.svg is current', () => {
  assert.ok(read('index.html').includes(`<!-- splash -->${splashHTML()}<!-- /splash -->`));
  assert.equal(read('icons/icon.svg').trim(), markSVG({ ground: 'rounded' }));
});

test('rendering audit: no HTML-string or code-string sinks anywhere in the app', () => {
  const files = [...walk('js'), 'sw.js'];
  const SINKS = [
    [/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/, 'HTML string sink'],
    [/\beval\s*\(|new\s+Function\s*\(/, 'code from a string'],
    [/setTimeout\(\s*['"`]|setInterval\(\s*['"`]/, 'timer with a code string'],
    [/setAttribute\(\s*['"]on\w+/, 'inline event handler attribute'],
    [/setAttribute\(\s*['"](?:style|srcdoc)['"]/, 'style or srcdoc attribute (CSP blocks inline style; use CSSOM)'],
    [/javascript:/i, 'javascript: URL'],
    [/createContextualFragment|DOMParser|\.srcdoc\s*=/, 'markup parser'],
  ];
  for (const f of files) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // comments don't count
    for (const [re, what] of SINKS) assert.doesNotMatch(code, re, `${f}: ${what}`);
  }
  // h() writes props as attributes only for safe names; event handlers go through addEventListener.
  const ui = read('js/ui.js');
  assert.match(ui, /else if \(k\.startsWith\('on'\)\) el\.addEventListener\(k\.slice\(2\), v\);/);
  assert.match(ui, /el\.append\(c instanceof Node \? c : document\.createTextNode\(String\(c\)\)\)/);
});

test('rendering audit: index.html has no inline script, style or event handlers', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'inline <script>');
  assert.doesNotMatch(html, /<style|\sstyle=|\son[a-z]+=/i);
  for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(!/^https?:/.test(m[1]), `external script ${m[1]}`);
});

test('security: the app-lock PIN is never stored or exported, only its salted hash', () => {
  const lock = read('js/lock.js');
  assert.match(lock, /hashPin\(pin\)/);
  assert.doesNotMatch(lock, /setMeta\('appLock',\s*\{\s*pin/);
  const store = read('js/store.js');
  const exp = store.slice(store.indexOf('export function exportData'), store.indexOf('export async function markExported'));
  assert.doesNotMatch(exp, /appLock|lockFails|meta/, 'exportData must not include the lock');
});
