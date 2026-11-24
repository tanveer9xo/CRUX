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

test('no network calls or third-party hosts in the app', () => {
  const src = walk('js').map((f) => read(f)).join('\n') + read('index.html') + read('css/app.css');
  assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\/(?!www\.w3\.org)/);
});

test('the splash in index.html matches the brand mark, and icon.svg is current', () => {
  assert.ok(read('index.html').includes(`<!-- splash -->${splashHTML()}<!-- /splash -->`));
  assert.equal(read('icons/icon.svg').trim(), markSVG({ ground: 'rounded' }));
});
