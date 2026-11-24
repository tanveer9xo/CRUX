// End-to-end check of the deployable site served under /CRUX/, the way https://<user>.github.io/CRUX/ serves it.
// Headless Chrome over the DevTools protocol, no dependencies.
//   node tests/browser/app.mjs              (npm run test:browser)
//   CHROME=/path/to/chrome   SHOTS=/some/dir (save phone-size screenshots of each screen)
// Checks: install criteria, service worker scope and precache, offline start, quick add in 3 taps, edit,
// delete + undo, plan edits, insights, history search, export + import, and that VANE's storage on the
// same origin is left alone.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../tools/build-site.mjs';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.env.SHOTS || null;
const CDP = 9347;
const HTTP = 8787;
const ORIGIN = `http://127.0.0.1:${HTTP}`;
const BASE = `${ORIGIN}/CRUX/`;
const WORK = mkdtempSync(join(tmpdir(), 'crux-e2e-'));
const DL = join(WORK, 'downloads');
mkdirSync(DL);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { assets } = buildSite(join(WORK, 'www', 'CRUX'));
// A stand-in for VANE on the same origin.
mkdirSync(join(WORK, 'www', 'VANE'));
writeFileSync(join(WORK, 'www', 'VANE', 'index.html'), '<!doctype html><link rel="icon" href="data:,"><title>VANE</title><p>vane</p>');

const server = spawn('python3', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: join(WORK, 'www'), stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(WORK, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const finish = (code) => {
  try { chrome.kill(); } catch { /* */ }
  try { server.kill(); } catch { /* */ }
  setTimeout(() => { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* */ } process.exit(code); }, 300);
};
process.on('unhandledRejection', (e) => { console.error('ERROR', e); finish(2); });
process.on('exit', () => { try { chrome.kill(); server.kill(); } catch { /* */ } }); // never leave Chrome running on a crash
setTimeout(() => { console.error('ERROR timed out'); finish(3); }, 240000).unref();

let target;
for (let i = 0; i < 75 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
}
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
const requests = [];
const failed = [];
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
  else if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failed.push(`${m.params.response.status} ${m.params.response.url}`);
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  in: ${expression.slice(0, 120)}`);
  return r.result.value;
};
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const click = async (sel) => { await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no ' + ${JSON.stringify(sel)}); el.click(); return true; })()`); await sleep(250); };
const clickText = async (sel, t) => { await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.includes(${JSON.stringify(t)})); if (!el) throw new Error('no ' + ${JSON.stringify(sel)} + ' with ' + ${JSON.stringify(t)}); el.click(); return true; })()`); await sleep(300); };
// Real taps through the input pipeline (so focus and user activation behave as on a phone).
const tap = async (sel) => {
  const box = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(250);
};
const typeText = async (t) => { await send('Input.insertText', { text: t }); await sleep(100); };
const shot = async (name) => {
  // Every screen we photograph must fit the phone's width (no sideways scrolling).
  // Measured against the phone's width (390), not innerWidth: a too-wide page widens innerWidth itself.
  const wide = await ev(`[innerWidth !== 390 ? 'layout viewport is ' + innerWidth + 'px wide' : null, scrollX ? 'scrolled sideways by ' + scrollX : null,
    ...[...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.right > 391 && !el.closest('.chips-scroll, .sr-only'); }).map((el) => String(el.className?.baseVal ?? el.className) || el.tagName)].filter(Boolean).slice(0, 4)`);
  check(wide.length === 0, `${name}: fits the screen width${wide.length ? ` (too wide: ${wide.join(', ')})` : ''}`);
  if (!SHOTS) return;
  await sleep(350);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(s.data, 'base64'));
};
const idb = (store) => ev(`new Promise((ok, no) => { const r = indexedDB.open('crux'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => { ok(q.result); r.result.close(); }; q.onerror = () => no(q.error); }; })`);

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// An Android phone (touch on a Mac would otherwise look like an iPad, which exports through the share sheet).
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });

// ---- VANE's data on the same origin, before CRUX ever runs ----
await send('Page.navigate', { url: `${ORIGIN}/VANE/` });
await sleep(600);
await ev(`(async () => { localStorage.setItem('appearance', 'dark'); await caches.open('workout-tracker-1.14.0'); await new Promise((ok) => { const r = indexedDB.open('workout-tracker', 1); r.onupgradeneeded = () => r.result.createObjectStore('x'); r.onsuccess = () => { r.result.close(); ok(); }; }); return true; })()`);

// ---- first visit ----
await send('Page.navigate', { url: BASE });
await sleep(2500);
check((await text('main h1')) !== null && (await ev(`!!document.querySelector('.hero')`)), `Home renders at /CRUX/ (“${await text('main h1')}”)`);
const scope = await ev(`navigator.serviceWorker.ready.then((r) => r.scope)`);
check(scope === BASE, `service worker scope is ${scope}`);
await ev(`new Promise((ok) => { if (navigator.serviceWorker.controller) ok(true); else navigator.serviceWorker.addEventListener('controllerchange', () => ok(true)); setTimeout(() => ok(false), 5000); })`);
const version = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8').match(/VERSION = '([^']+)'/)[1];
const cached = await ev(`caches.keys().then(async (keys) => { const c = await caches.open('crux-${version}'); return { keys, urls: (await c.keys()).map((r) => r.url) }; })`);
check(cached.keys.includes(`crux-${version}`), `cache is named crux-${version}`);
check(cached.urls.length === assets.length + 1 && cached.urls.every((u) => u.startsWith(BASE)), `all ${assets.length + 1} precached files are under /CRUX/`);
check(cached.keys.includes('workout-tracker-1.14.0'), 'VANE’s cache on the same origin is untouched');
check(await ev(`localStorage.getItem('appearance') === 'dark'`), 'VANE’s localStorage is untouched');
check(await ev(`indexedDB.databases().then((d) => d.some((x) => x.name === 'workout-tracker') && d.some((x) => x.name === 'crux'))`), 'CRUX uses its own database (“crux”) next to VANE’s');
check(await ev(`Object.keys(localStorage).every((k) => k === 'appearance' || k.startsWith('crux'))`), 'every localStorage key CRUX wrote starts with “crux”');

const cats = await idb('categories');
check(cats.length === 8 && cats.every((c) => !/\d/.test(c.name)), `seeded ${cats.length} generic sample categories, no entries`);
check((await idb('entries')).length === 0, 'no sample entries are seeded');
await shot('01-home-empty');

// ---- manifest + install criteria ----
const man = await send('Page.getAppManifest');
check(man.url === `${BASE}manifest.webmanifest` && (man.errors ?? []).length === 0, `manifest at ${man.url}, ${(man.errors ?? []).length} errors`);
const data = JSON.parse(man.data);
const abs = (u) => new URL(u, man.url).href;
check(abs(data.start_url) === BASE && abs(data.scope) === BASE && data.display === 'standalone', 'start_url and scope are /CRUX/, display standalone');
const inst = await send('Page.getInstallabilityErrors');
check((inst.installabilityErrors ?? []).length === 0, `Chrome's install criteria pass${(inst.installabilityErrors ?? []).length ? `: ${JSON.stringify(inst.installabilityErrors)}` : ''}`);

// ---- quick add: 3 taps (+, chip, Save) ----
await tap('.tab-add');
check(await ev(`document.activeElement?.id === 'amount'`), 'tap 1 (+) opens Add with the amount field focused');
await typeText('1250.5');
await shot('02-add');
await tap('.chip[role=radio]');
await tap('.add-form button[type=submit]');
await sleep(300);
let entries = await idb('entries');
check(entries.length === 1 && entries[0].amount === 125050 && Number.isInteger(entries[0].amount), `taps 2–3 (chip, Save) save ₹1,250.50 as ${entries[0]?.amount} paise`);
check(await ev(`location.hash === '#/' && document.querySelector('.hero-amt').textContent === '₹1,250.50'`), 'back on Home, total shows ₹1,250.50');
check(await ev(`!!document.querySelector('.banner')`), 'backup reminder shows (never exported)');

// validation: no category picked
await tap('.tab-add');
await typeText('99');
await tap('.add-form button[type=submit]');
check((await text('.form-error')) === 'Pick a category.', 'Save without a category asks for one');
await click('.page-head .icon-btn'); // cancel

// ---- edit, delete, undo ----
await click('.entry');
check((await text('main h1')) === 'Edit expense', 'tapping an entry opens it for editing');
await ev(`document.getElementById('note').value = 'weekly veg'; true`);
await click('.add-form button[type=submit]');
check((await idb('entries'))[0].note === 'weekly veg', 'edit saves the note');
await click('.entry');
await click('.page-head .icon-btn.danger');
await clickText('.sheet .btn', 'Delete');
await sleep(300);
check((await idb('entries')).length === 0, 'delete removes the entry');
check((await text('.toast-btn')) === 'Undo', 'an Undo button appears after delete');
await click('.toast-btn');
await sleep(300);
check((await idb('entries')).length === 1 && (await ev(`!!document.querySelector('.entry')`)), 'Undo brings the entry back');

// ---- sample history for the rest of the checks (generic numbers, test-only) ----
await ev(`(async () => {
  const store = await import('./js/store.js');
  const { addMonths, monthOf, todayYmd, lastDay } = await import('./js/dates.js');
  const cats = store.activeCategories();
  const now = monthOf(todayYmd());
  const day = +todayYmd().slice(8);
  let k = 0;
  for (let back = 5; back >= 0; back--) {
    const m = addMonths(now, -back);
    const last = back === 0 ? day : +lastDay(m).slice(8);
    for (let d = 1; d <= last; d += 2) {
      const c = cats[(d + back) % cats.length];
      const amount = (((d * 37 + back * 53 + k++ * 11) % 90) + 10) * 1000 + (k % 3 === 0 ? 50 : 0);
      await store.saveEntry({ amount, categoryId: c.id, date: m + '-' + String(d).padStart(2, '0'), note: k % 4 === 0 ? 'sample note ' + k : '' });
    }
  }
  return true;
})()`);
await send('Page.reload');
await sleep(1500);
await shot('03-home');

// ---- plan: budget change applies from this month onward ----
await click('.tabbar [data-tab=plan]');
const first = await ev(`document.querySelector('.budget-input').getAttribute('aria-label')`);
await ev(`(() => { const i = document.querySelector('.budget-input'); i.value = '9,500'; i.dispatchEvent(new Event('change')); return true; })()`);
await sleep(300);
const budgets = await idb('budgets');
const curMonth = await ev(`(async () => (await import('./js/dates.js')).todayYmd().slice(0, 7))()`);
const firstId = (await idb('categories')).sort((a, b) => a.order - b.order)[0].id;
check(budgets.find((b) => b.month === curMonth)?.plan[firstId] === 950000, `Plan: ${first.split(' budget')[0]} budget set to ₹9,500 (950000 paise) for ${curMonth}`);
await shot('04-plan');
await click('.plan-cat');
await shot('05-plan-edit');
await click('.sheet-head .icon-btn');
await sleep(250);

// ---- insights ----
await click('.tabbar [data-tab=insights]');
check(!!(await ev(`document.querySelector('.cmp-total .hero-amt')?.textContent`)), 'Insights: month to date renders');
await shot('06-insights-mtd');
await clickText('.seg', 'Months');
check(await ev(`document.querySelectorAll('.chart').length >= 2`), 'Insights: full-month comparison with 6-month trend charts');
await shot('07-insights-months');
await ev(`document.getElementById('h-trend').scrollIntoView(); true`);
await shot('07b-insights-trend');
await clickText('.seg', 'Budget');
check(await ev(`document.querySelectorAll('.prog-row').length >= 8`), 'Insights: budget progress per category');
await shot('08-insights-budget');

// ---- history ----
await click('.tabbar [data-tab=history]');
const before = await ev(`document.querySelectorAll('.entry').length`);
await ev(`(() => { const s = document.querySelector('.search-input'); s.value = 'sample note'; s.dispatchEvent(new Event('input')); return true; })()`);
const after = await ev(`document.querySelectorAll('.entry').length`);
check(before > 0 && after > 0 && after < before, `History: search narrows ${before} → ${after} entries`);
await ev(`(() => { const s = document.querySelector('.search-input'); s.value = ''; s.dispatchEvent(new Event('input')); return true; })()`);
await click('.month-nav .icon-btn');
check((await text('.month-nav-label')) !== null, `History: month picker moves to ${await text('.month-nav-label')}`);
await click('.tabbar [data-tab=history]');
await shot('09-history');

// ---- export & import ----
await click('.tabbar [data-tab=home]');
await click('.banner .btn-primary');
await shot('10-settings');
await click('#export-btn');
await sleep(1200);
const files = readdirSync(DL).filter((f) => f.startsWith('crux-backup-') && f.endsWith('.json'));
check(files.length === 1, `Export downloads ${files[0] ?? `nothing (toast: ${await text('.toast')})`}`);
if (!files.length) finish(1);
const backup = JSON.parse(readFileSync(join(DL, files[0]), 'utf8'));
const count = (await idb('entries')).length;
check(backup.app === 'crux' && backup.entries.length === count && backup.entries.every((e) => Number.isInteger(e.amount)), `the backup holds all ${count} entries as integer paise`);
await click('.tabbar [data-tab=home]');
check(!(await ev(`!!document.querySelector('.banner')`)), 'backup reminder is gone after exporting');

// Import a smaller backup: the app must ask first, and Cancel must change nothing.
const small = { ...backup, entries: backup.entries.slice(0, 3) };
writeFileSync(join(WORK, 'small.json'), JSON.stringify(small));
await click('.page-head .icon-btn'); // settings
const { root } = await send('DOM.getDocument');
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
await send('DOM.setFileInputFiles', { nodeId, files: [join(WORK, 'small.json')] });
await sleep(600);
check((await text('.sheet h2')) === 'Replace all your data?', 'Import asks before replacing anything');
await shot('11-import-confirm');
await clickText('.sheet .btn', 'Cancel');
check((await idb('entries')).length === count, 'Cancel leaves the data as it was');
await send('DOM.setFileInputFiles', { nodeId, files: [join(WORK, 'small.json')] });
await sleep(600);
await clickText('.sheet .btn', 'Replace');
await sleep(500);
check((await idb('entries')).length === 3, 'Replace imports the backup (3 entries)');
// A damaged file is refused.
writeFileSync(join(WORK, 'bad.json'), JSON.stringify({ ...backup, entries: [{ ...backup.entries[0], amount: 12.5 }] }));
await click('.page-head .icon-btn');
const n2 = (await send('DOM.querySelector', { nodeId: (await send('DOM.getDocument')).root.nodeId, selector: '#import-file' })).nodeId;
await send('DOM.setFileInputFiles', { nodeId: n2, files: [join(WORK, 'bad.json')] });
await sleep(600);
check((await text('.sheet h2')) === 'Can’t import this file' && (await idb('entries')).length === 3, 'a damaged backup is refused and nothing changes');
await clickText('.sheet .btn', 'OK');
check((await text('#app-version')) === version, `Settings shows version ${version}`);

// ---- offline ----
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.navigate', { url: `${BASE}#/insights` });
await sleep(2000);
check((await text('main h1')) === 'Insights', 'offline: the app opens from the cache at a deep link (#/insights)');
await click('.tabbar [data-tab=home]');
await tap('.tab-add');
await typeText('40');
await tap('.chip[role=radio]');
await tap('.add-form button[type=submit]');
check((await idb('entries')).length === 4, 'offline: adding an expense works');
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

check(failed.length === 0, `no failed requests${failed.length ? `: ${failed.slice(0, 3).join(', ')}` : ''}`);
const outside = requests.filter((u) => /^https?:/.test(u) && !u.startsWith(BASE) && !u.startsWith(`${ORIGIN}/VANE/`));
check(outside.length === 0, `nothing loads from outside /CRUX/${outside.length ? `: ${outside.slice(0, 3).join(', ')}` : ''}`);
check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (served at ${BASE})`);
finish(failures ? 1 : 0);
