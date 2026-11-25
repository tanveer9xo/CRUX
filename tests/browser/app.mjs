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
const setVal = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no ' + ${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
// Go to a screen; if it's already showing, redraw it (data may have been changed behind its back).
// JSON with object keys sorted, so two records with the same fields compare equal whatever order they were built in.
const norm = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const nav = async (hash) => { await ev(`location.hash === ${JSON.stringify(hash)} ? import('./js/router.js').then((r) => { r.refresh(); return true; }) : (location.hash = ${JSON.stringify(hash)}, true)`); await sleep(450); };
const dayOffset = (n) => ev(`import('./js/dates.js').then((d) => d.addDays(d.todayYmd(), ${n}))`);
// Click a button by its exact text in the topmost open sheet (a confirm can sit on top of a form).
const clickTop = async (label) => { await ev(`(() => { const sheets = document.querySelectorAll('.sheet'); const top = sheets[sheets.length - 1]; const b = [...top.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) throw new Error('no button ' + ${JSON.stringify(label)}); b.click(); return true; })()`); await sleep(350); };
const typeText = async (t) => { await send('Input.insertText', { text: t }); await sleep(100); };
const shot = async (name) => {
  // Every screen we photograph must fit the phone's width (no sideways scrolling).
  // Measured against the phone's width (390), not innerWidth: a too-wide page widens innerWidth itself.
  const wide = await ev(`[innerWidth !== 390 ? 'layout viewport is ' + innerWidth + 'px wide' : null, scrollX ? 'scrolled sideways by ' + scrollX : null,
    ...[...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.right > 391 && !el.closest('.chips-scroll, .sr-only'); }).map((el) => String(el.className?.baseVal ?? el.className) || el.tagName)].filter(Boolean).slice(0, 4)`);
  check(wide.length === 0, `${name}: fits the screen width${wide.length ? ` (too wide: ${wide.join(', ')})` : ''}`);
  // Nothing may spill out of the card or row that holds it.
  const spill = await ev(`[...document.querySelectorAll('main .card, main .bill-row, main .strip-row, main .cat-row')].flatMap((c) => { const cr = c.getBoundingClientRect(); return [...c.querySelectorAll('*')].filter((el) => { if (el.closest('.sr-only')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.right > cr.right + 0.5; }).map((el) => String(el.className?.baseVal ?? el.className) || el.tagName); }).slice(0, 4)`);
  check(spill.length === 0, `${name}: nothing spills out of its card${spill.length ? ` (${spill.join(', ')})` : ''}`);
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
// Fake VANE data of every kind CRUX could be tempted to wipe: localStorage, a cache with a file in it, an
// IndexedDB database with a record, and a second database. (CRUX's own marker key is added to prove the
// reset does clear crux-prefixed keys.)
await ev(`(async () => {
  localStorage.setItem('appearance', 'dark');
  localStorage.setItem('backupNudgeDismissedAt', '1700000000000');
  localStorage.setItem('cruxLeftover', 'crux-owned key');
  const c = await caches.open('workout-tracker-1.14.0');
  await c.put('/VANE/vane-file.txt', new Response('vane cached file'));
  for (const name of ['workout-tracker', 'vane-extra']) {
    await new Promise((ok, no) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('sessions', { keyPath: 'id' }); r.onsuccess = () => { const tx = r.result.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ id: 1, note: 'vane workout ' + name }); tx.oncomplete = () => { r.result.close(); ok(); }; }; r.onerror = () => no(r.error); });
  }
  return true;
})()`);

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
check(await ev(`Object.keys(localStorage).every((k) => k === 'appearance' || k === 'backupNudgeDismissedAt' || k.startsWith('crux'))`), 'every localStorage key CRUX wrote starts with “crux”');

const cats = await idb('categories');
const WANT = ['Rent', 'Bike EMI', 'Buffer/Miscellaneous', 'Groceries', 'CC Payment', 'Dine In/Out', 'Gym', 'Petrol', 'Bhatuk', 'Insurance', 'Subscriptions', 'Wifi', 'Furniture', 'Electricity', 'Supplements', 'Cosmetics', 'Bike Maintenance', 'Phone Bill'];
check(JSON.stringify([...cats].sort((a, b) => a.order - b.order).map((c) => c.name)) === JSON.stringify(WANT), 'seeded the 18 categories in the requested order');
check(new Set(cats.map((c) => c.emoji)).size === 18 && new Set(cats.map((c) => c.color)).size === 18, 'each seeded category has its own emoji and colour');
const seededPlan = (await idb('budgets'))[0]?.plan ?? {};
check(Object.keys(seededPlan).length === 18 && Object.values(seededPlan).every((v) => v === 0), 'every seeded budget is ₹0');
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
// 18 chips: all inside the screen, none cut off, none overlapping, and Save pinned in view above the tab bar.
const chipBox = await ev(`(() => { const r = [...document.querySelectorAll('.add-form .chip[role=radio]')].map((c) => { const b = c.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, clipped: c.scrollWidth > c.clientWidth + 1 }; }); return r; })()`);
check(chipBox.length === 18 && chipBox.every((c) => c.l >= 0 && c.r <= 390 && !c.clipped), 'Add: all 18 chips fit within the screen width, none clipped');
const overlap = chipBox.some((a, i) => chipBox.some((b, j) => j > i && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1));
check(!overlap, 'Add: no chips overlap');
const saveBox = await ev(`(() => { const s = document.querySelector('.add-form button[type=submit]').getBoundingClientRect(); const t = document.querySelector('.tabbar').getBoundingClientRect(); return { sBottom: s.bottom, sTop: s.top, tabTop: t.top, tall: document.documentElement.scrollHeight > innerHeight }; })()`);
check(saveBox.sBottom <= saveBox.tabTop && saveBox.sTop > 0, `Add: Save stays visible above the tab bar (page is ${saveBox.tall ? 'taller than the screen, so it scrolls' : 'one screen'})`);
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
check(!(await ev(`!!document.querySelector('.toast')`)), 'opening Add clears the old toast, so it can’t cover Save');
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

// The last chip (needs scrolling to) can be picked and saved: Phone Bill, with Save still pinned in view.
await tap('.tab-add');
await typeText('499');
await ev(`document.querySelector('.add-form .chip:last-of-type').scrollIntoView({ block: 'center' }); true`);
await sleep(300);
await shot('02b-add-scrolled');
await tap('.add-form .chip:last-of-type');
check(await ev(`document.querySelector('.add-form .chip[aria-checked=true]')?.textContent.includes('Phone Bill')`), 'Add: scrolling to the last chip and tapping it selects Phone Bill');
await tap('.add-form button[type=submit]');
await sleep(300);
const phone = (await idb('entries')).find((e) => e.amount === 49900);
check(phone && cats.find((c) => c.id === phone.categoryId)?.name === 'Phone Bill', 'Add: the entry saved under Phone Bill');

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
await nav('#/plan');
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
await nav('#/insights');
check(!!(await ev(`document.querySelector('.cmp-total .hero-amt')?.textContent`)), 'Insights: month to date renders');
await shot('06-insights-mtd');
await clickText('.seg', 'Months');
check(await ev(`document.querySelectorAll('.chart').length >= 2`), 'Insights: full-month comparison with 6-month trend charts');
await shot('07-insights-months');
await ev(`document.getElementById('h-trend').scrollIntoView(); true`);
await shot('07b-insights-trend');
await clickText('.seg', 'Budget');
check(await ev(`document.querySelectorAll('.prog-row').length >= 18`), 'Insights: budget progress per category');
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

// ---- navigation: Goals and Bills are one tap away; the + button is still the centre slot ----
await nav('#/');
const tabs = await ev(`[...document.querySelectorAll('.tabbar a')].map((a) => { const r = a.getBoundingClientRect(); return { tab: a.dataset.tab, h: r.height, w: r.width, cx: r.left + r.width / 2 }; })`);
check(JSON.stringify(tabs.map((x) => x.tab)) === JSON.stringify(['home', 'history', 'add', 'goals', 'bills']), 'tab bar: Home, History, +, Goals, Bills (five slots, not crowded)');
check(tabs.every((x) => x.h >= 48 && x.w >= 60), `tab bar: every slot is at least 60×48 (narrowest ${Math.round(Math.min(...tabs.map((x) => x.w)))}px)`);
check(Math.abs(tabs[2].cx - 195) <= 1, '+ stays centred in the tab bar');
await click('.tabbar [data-tab=goals]');
check((await text('main h1')) === 'Goals', 'Goals: one tap from the tab bar');
await click('.tabbar [data-tab=bills]');
check((await text('main h1')) === 'Bills', 'Bills: one tap from the tab bar');
await click('#menu-btn');
check((await ev(`[...document.querySelectorAll('.menu-item strong')].map((e) => e.textContent).join(',')`)) === 'Insights,Plan,Settings', 'menu in the header holds Insights, Plan and Settings');
await shot('15-menu');
await clickText('.menu-item', 'Insights');
check((await text('main h1')) === 'Insights', 'Insights: reached from the menu');

// ---- goals ----
await nav('#/');
const spentBefore = await text('.hero-amt');
await nav('#/insights');
const mtdBefore = await text('.cmp-total .hero-amt');
const seedGoals = (await idb('goals')).sort((a, b) => a.order - b.order);
check(JSON.stringify(seedGoals.map((g) => g.name)) === JSON.stringify(['Emergency fund', 'Wedding fund', 'Long-term investments']) && seedGoals.every((g) => g.target === 0 && g.targetDate === null && g.monthlyPlan === 0), 'seeded goals: Emergency fund, Wedding fund, Long-term investments, all with ₹0 targets');
check((await idb('goalAdds')).length === 0 && (await idb('bills')).length === 0, 'no goal adds and no bills are seeded');
await click('.tabbar [data-tab=goals]');
check((await ev(`[...document.querySelectorAll('.goal-card .goal-title')].map((e) => e.textContent.trim()).join('|')`)).includes('Emergency fund') && (await ev(`document.querySelectorAll('.goal-card').length`)) === 3, 'Goals lists the three seeded goals');
check((await text('.goal-card')).includes('No target set'), 'a goal without a target shows only what is saved');
// Edit Emergency fund: target, date, plan, two buckets.
const future = await dayOffset(400);
await click('.goal-card .icon-btn');
await setVal('#goal-target', '10,000');
await setVal('#goal-date', future);
await setVal('#goal-plan', '1,000');
await click('#add-bucket');
await click('#add-bucket');
await ev(`(() => { const i = document.querySelectorAll('.bucket-edit .bucket-row input'); i[0].value = 'Savings account'; i[0].dispatchEvent(new Event('input')); i[1].value = 'FD'; i[1].dispatchEvent(new Event('input')); return true; })()`);
await shot('16-goal-edit');
await click('#goal-save');
await sleep(300);
let eg = (await idb('goals')).find((g) => g.name === 'Emergency fund');
check(eg.target === 1000000 && eg.targetDate === future && eg.monthlyPlan === 100000 && eg.buckets.map((b) => b.name).join() === 'Savings account,FD', 'editing a goal saves target, date, monthly plan and buckets (as paise)');
// Add money into the FD bucket.
await click('.goal-card .btn-primary');
await setVal('#gm-amount', '2,500');
await clickText('.sheet .chip', 'FD');
await click('#gm-save');
await sleep(300);
let adds = await idb('goalAdds');
const fdId = eg.buckets[1].id;
check(adds.length === 1 && adds[0].amount === 250000 && adds[0].bucketId === fdId && Number.isInteger(adds[0].amount), 'Add money saves ₹2,500 into the FD bucket as 250000 paise');
let card = await text('.goal-card');
check(card.includes('₹2,500') && card.includes('25%') && card.includes('₹7,500') && card.includes('to go'), 'goal card: saved ₹2,500, 25 % of target, ₹7,500 to go');
check(/Needs ₹\d[\d,.]* a month to reach it by/.test(card), `goal card: monthly amount needed (${(card.match(/Needs [^(]*/) ?? [''])[0].trim()})`);
check(card.includes('This month: +₹2,500 of ₹1,000 planned'), 'goal card: this month’s adds against the planned monthly amount');
check(card.includes('Where it sits') && card.includes('FD') && card.includes('100%'), 'goal card: split by bucket');
await shot('17-goals');
// Withdrawals: too much is refused; a valid one lowers the total.
await clickText('.goal-card .btn', 'Withdraw');
await setVal('#gm-amount', '3,000');
await clickText('.sheet .chip', 'FD');
await click('#gm-save');
check((await text('.sheet .form-error')).includes('only ₹2,500 in this bucket'), 'withdrawing more than the bucket holds is refused');
await setVal('#gm-amount', '500');
await click('#gm-save');
await sleep(300);
adds = await idb('goalAdds');
check(adds.length === 2 && adds.some((a) => a.amount === -50000 && a.bucketId === fdId), 'a withdrawal is stored as a negative add (−50000 paise)');
card = await text('.goal-card');
check(card.includes('₹2,000') && card.includes('20%') && card.includes('This month: +₹2,000'), 'after the withdrawal: saved ₹2,000 (20 %), this month +₹2,000');
// A no-target goal (Long-term investments) takes adds too.
await ev(`(() => { const cards = [...document.querySelectorAll('.goal-card')]; [...cards[2].querySelectorAll('.btn-primary')][0].click(); return true; })()`);
await sleep(300);
await setVal('#gm-amount', '1,000');
await click('#gm-save');
await sleep(300);
const lti = await ev(`[...document.querySelectorAll('.goal-card')][2].textContent`);
check(lti.includes('₹1,000') && lti.includes('No target set') && !lti.includes('%'), 'Long-term investments: saved ₹1,000, no target, no percentage');
// Goal money is not spending.
await nav('#/');
check((await text('.hero-amt')) === spentBefore, `Home spending is unchanged by goal adds (${spentBefore})`);
await nav('#/insights');
check((await text('.cmp-total .hero-amt')) === mtdBefore, `Insights month-to-date is unchanged by goal adds (${mtdBefore})`);
check((await text('#insights-saved')).includes('Saved this month: ₹3,000'), 'Insights: “Saved this month: ₹3,000” (net of the withdrawal, across goals)');
await shot('18-insights-saved');
await nav('#/history');
check(!(await text('main')).includes('Emergency fund'), 'History shows expenses only, no goal adds');
await nav('#/');
check((await ev(`document.querySelectorAll('#goal-strip .strip-row').length`)) === 3 && (await text('#goal-strip')).includes('₹2,000'), 'Home: compact goals strip with the three goals');
// Detail page: entries, edit, delete with undo.
await ev(`document.getElementById('goal-strip').scrollIntoView({ block: 'center' }); true`);
await shot('23b-home-goals');
await ev(`document.querySelector('#goal-strip .strip-row').click(); true`);
await sleep(400);
check((await text('main h1')).includes('Emergency fund') && (await ev(`document.querySelectorAll('.goal-detail .entry').length`)) === 2, 'goal detail lists its two entries');
await shot('19-goal-detail');
await click('.goal-detail .entry');
await click('.sheet .btn-ghost-danger');
await sleep(300);
check((await idb('goalAdds')).length === 2 && (await text('.toast-btn')) === 'Undo', 'deleting a goal entry offers Undo');
await click('.toast-btn');
await sleep(300);
check((await idb('goalAdds')).length === 3, 'Undo brings the goal entry back');
// New goal, archive, restore.
await nav('#/goals');
await click('#new-goal');
await setVal('#goal-name', 'Trip');
await click('#goal-save');
await sleep(300);
check((await idb('goals')).some((g) => g.name === 'Trip' && g.target === 0), 'a new goal can be added');
await ev(`[...document.querySelectorAll('.goal-card')].find((c) => c.textContent.includes('Trip')).querySelector('.icon-btn').click(); true`);
await sleep(300);
await click('#goal-archive');
await clickTop('Archive');
await sleep(300);
check((await idb('goals')).find((g) => g.name === 'Trip').archived === true && (await text('.archived summary')).includes('Archived (1)'), 'a goal can be archived');
await ev(`document.querySelector('.archived').open = true; true`);
await clickText('.archived .btn', 'Restore');
await sleep(300);
check((await idb('goals')).find((g) => g.name === 'Trip').archived === false, 'and restored');

// ---- bills ----
await nav('#/bills');
check((await text('.empty-title')) === 'No bills or renewals yet', 'Bills starts empty (no seeded items)');
await nav('#/');
check(!(await ev(`!!document.querySelector('#upcoming')`)), 'Home shows no Upcoming card when nothing is due');
const catIds = Object.fromEntries((await idb('categories')).map((c) => [c.name, c.id]));
const yesterday = await dayOffset(-1);
const soonDay = await dayOffset(2);
await nav('#/bills');
await click('#new-bill');
await setVal('#bill-name', 'Bike EMI');
await clickText('.sheet .chip', 'EMI');
check(await ev(`document.getElementById('bill-log').checked`), 'bill form: “log an expense when paid” defaults ON for an EMI');
await setVal('#bill-amount', '3,500');
await setVal('#bill-due', yesterday);
await setVal('#bill-left', '2');
await setVal('#bill-cat', catIds.Petrol);
await shot('20-bill-form');
await click('#bill-save');
await sleep(300);
let emi = (await idb('bills')).find((b) => b.name === 'Bike EMI');
check(emi && emi.type === 'emi' && emi.amount === 350000 && emi.installmentsLeft === 2 && emi.logExpense === true && emi.categoryId === catIds.Petrol && emi.dueDate === yesterday && emi.anchorDay === Number(yesterday.slice(8)), 'an EMI saves with amount, instalments left, linked category and due-day anchor');
// Credit card default: OFF, and it follows the type until the toggle is touched by hand.
await click('#new-bill');
await setVal('#bill-name', 'Card');
await clickText('.sheet .chip', 'Credit card due');
check(!(await ev(`document.getElementById('bill-log').checked`)) && (await text('.sheet')).includes('count the money twice'), 'bill form: “log an expense” defaults OFF for a credit card due, with the reason');
await clickText('.sheet .chip', 'Subscription');
check(await ev(`document.getElementById('bill-log').checked`), 'switching to Subscription turns it back ON (default follows the type)');
await clickText('.sheet .chip', 'Credit card due');
await ev(`document.getElementById('bill-log').click(); true`);
await clickText('.sheet .chip', 'Insurance');
check(await ev(`document.getElementById('bill-log').checked`), 'a hand-set toggle is not overwritten by a type change');
await ev(`document.getElementById('bill-log').click(); true`);
await clickText('.sheet .chip', 'Credit card due');
await setVal('#bill-due', soonDay);
await setVal('#bill-warn', '5');
await click('#bill-save');
await sleep(300);
const card2 = (await idb('bills')).find((b) => b.name === 'Card');
check(card2.type === 'cc' && card2.logExpense === false && card2.amount === null && card2.warnDays === 5, 'a credit card due saves with logging OFF and no amount');
// A far-off one, through the store.
await ev(`(async () => { const s = await import('./js/store.js'); const d = await import('./js/dates.js'); await s.saveBill({ name: 'Insurance', type: 'insurance', amount: 1200000, recurrence: 'yearly', dueDate: d.addDays(d.todayYmd(), 60), anchorDay: +d.addDays(d.todayYmd(), 60).slice(8), warnDays: 14, endDate: null, installmentsLeft: null, note: '', categoryId: null, logExpense: true, archived: false, archivedReason: null }); return true; })()`);
await nav('#/bills');
check((await ev(`[...document.querySelectorAll('.bill-group')].map((g) => g.getAttribute('aria-label') + ':' + g.querySelectorAll('.bill-row').length).join(',')`)) === 'Overdue:1,Due soon:1,Later:1', 'Bills groups: Overdue 1, Due soon 1, Later 1');
check((await text('.g-overdue')).includes('1 day overdue') && (await text('.g-overdue')).includes('2 left'), 'overdue row says “1 day overdue” and “2 left”');
await shot('21-bills');
await click('.g-overdue .bill-main');
await shot('22-bill-sheet');
await click('.sheet-head .icon-btn');
await sleep(250);
await nav('#/');
check((await text('#upcoming')).includes('Upcoming · 1 overdue') && (await ev(`document.querySelectorAll('#upcoming .bill-row').length`)) === 2, 'Home: Upcoming card shows the overdue EMI and the card due soon');
await shot('23-home-upcoming');
// Mark paid (EMI logs an expense): Add opens prefilled.
const entriesN = (await idb('entries')).length;
await click('#upcoming .btn-paid');
check(await ev(`location.hash === '#/add'`) && (await text('main h1')) === 'Add expense', 'Mark paid opens Add');
check((await ev(`document.getElementById('amount').value`)) === '3500' && (await ev(`document.querySelector('.chip[aria-checked=true]')?.textContent`)).includes('Petrol') && (await ev(`document.getElementById('note').value`)) === 'Bike EMI', 'Add is prefilled: ₹3,500, category Petrol, note “Bike EMI”');
check((await text('#paying')).includes('Bike EMI marked paid') && (await text('#paying')).includes('Next due'), 'Add says it was marked paid and when it is next due');
emi = (await idb('bills')).find((b) => b.name === 'Bike EMI');
check(emi.installmentsLeft === 1 && emi.dueDate > yesterday && !emi.archived, 'the EMI moved to next month with 1 instalment left');
await shot('24-add-prefilled');
await tap('.add-form button[type=submit]');
await sleep(300);
const logged = (await idb('entries')).find((e) => e.note === 'Bike EMI');
check((await idb('entries')).length === entriesN + 1 && logged.amount === 350000 && logged.categoryId === catIds.Petrol, 'Save logs the expense (₹3,500, Petrol): 2 taps from Home');
// Pay the last instalment, skipping the expense (cancel): the EMI archives itself.
await nav('#/bills');
await click('button[aria-label="Mark Bike EMI paid"]');
await click('.page-head .icon-btn'); // close Add: skip logging
await sleep(300);
emi = (await idb('bills')).find((b) => b.name === 'Bike EMI');
check(emi.archived && emi.archivedReason === 'installments' && emi.installmentsLeft === 0 && (await idb('entries')).length === entriesN + 1, 'last instalment paid: archived as “no instalments left”, and closing Add logged nothing');
// Credit card: mark paid logs nothing, offers Undo.
await nav('#/bills');
const cardDue = card2.dueDate;
await click('button[aria-label="Mark Card paid"]');
await sleep(300);
let card3 = (await idb('bills')).find((b) => b.name === 'Card');
check(await ev(`location.hash === '#/bills'`) && card3.dueDate > cardDue && (await idb('entries')).length === entriesN + 1, 'credit card mark paid: no expense offered, date moves on');
check((await text('.toast')).includes('Paid. Next due') && (await text('.toast-btn')) === 'Undo', 'a toast says what happened, with Undo');
await click('.toast-btn');
await sleep(300);
check((await idb('bills')).find((b) => b.name === 'Card').dueDate === cardDue, 'Undo puts the due date back');
// Skip this one.
await click('.g-soon .bill-main');
await click('#bill-skip');
await sleep(300);
card3 = (await idb('bills')).find((b) => b.name === 'Card');
check(card3.dueDate > cardDue && (await idb('entries')).length === entriesN + 1 && (await text('.toast')).startsWith('Skipped'), 'Skip this one: date moves on, no expense');
// Undo a mark-paid from the Add screen.
await ev(`(async () => { const s = await import('./js/store.js'); await s.saveBill({ name: 'One-off', type: 'bill', amount: 50000, recurrence: 'once', dueDate: (await import('./js/dates.js')).todayYmd(), anchorDay: 1, warnDays: 3, endDate: null, installmentsLeft: null, note: '', categoryId: null, logExpense: true, archived: false, archivedReason: null }); return true; })()`);
await nav('#/bills');
await click('button[aria-label="Mark One-off paid"]');
check((await text('#paying')).includes('finished and archived'), 'a one-time bill says it is finished once paid');
await click('#undo-paid');
await sleep(300);
check(!(await idb('bills')).find((b) => b.name === 'One-off').archived, 'Undo mark paid (from Add) restores the bill');
// ---- "Last day of the month": the due day tracks month length ----
const midMonth = await ev(`import('./js/dates.js').then((d) => d.todayYmd().slice(0, 8) + '15')`);
const monthEnd = await ev(`import('./js/dates.js').then((d) => d.lastDay(d.todayYmd().slice(0, 7)))`);
const nextMonthEnd = await ev(`import('./js/dates.js').then((d) => d.lastDay(d.addMonths(d.todayYmd().slice(0, 7), 1)))`);
await nav('#/bills');
await click('#new-bill');
await setVal('#bill-name', 'Maintenance');
await setVal('#bill-due', midMonth);
check((await text('.sheet')).includes('Last day of the month') && !(await ev(`document.getElementById('bill-lastday').checked`)), 'bill form has a “Last day of the month” option, off by default');
await click('#bill-lastday');
check((await ev(`document.getElementById('bill-due').value`)) === monthEnd, `switching it on sets the date to the month’s last day (${monthEnd})`);
await setVal('#bill-due', midMonth);
check((await ev(`document.getElementById('bill-due').value`)) === monthEnd, 'picking a mid-month date while it is on snaps back to the last day');
await shot('26-bill-lastday');
await click('#bill-log'); // off: Mark paid then skips the Add screen
await click('#bill-save');
await sleep(300);
let maint = (await idb('bills')).find((b) => b.name === 'Maintenance');
check(maint.lastDay === true && maint.anchorDay === 31 && maint.dueDate === monthEnd, 'it saves with lastDay on, anchor 31 and the month-end date');
// A one-time bill has no month-end option.
await click('#new-bill');
await clickText('.sheet .chip', 'One-time');
check(!(await ev(`!!document.getElementById('bill-lastday')`)), 'a one-time bill has no “last day” option');
await click('.sheet-head .icon-btn');
await sleep(250);
// Mark paid (logging off): next month's last day.
await nav('#/bills');
await click('button[aria-label="Mark Maintenance paid"]');
await sleep(300);
maint = (await idb('bills')).find((b) => b.name === 'Maintenance');
check(maint.dueDate === nextMonthEnd && maint.lastDay === true && (await text('.toast')).startsWith('Paid. Next due'), `mark paid moves it to next month’s last day (${nextMonthEnd}) and keeps the option on`);
// Switch it off: the date stays, and it becomes a fixed due day.
await clickText('.bill-main', 'Maintenance');
await click('#bill-edit');
check(await ev(`document.getElementById('bill-lastday').checked`), 'editing shows the option on');
await click('#bill-lastday');
check((await ev(`document.getElementById('bill-due').value`)) === nextMonthEnd, 'switching it off leaves the date as it was');
await click('#bill-save');
await sleep(300);
maint = (await idb('bills')).find((b) => b.name === 'Maintenance');
check(maint.lastDay === false && maint.dueDate === nextMonthEnd && maint.anchorDay === Number(nextMonthEnd.slice(8)), `switched off: a fixed due day (the ${maint.anchorDay}th) on the same date`);
// And back on.
await clickText('.bill-main', 'Maintenance');
await click('#bill-edit');
await click('#bill-lastday');
await click('#bill-save');
await sleep(300);
maint = (await idb('bills')).find((b) => b.name === 'Maintenance');
check(maint.lastDay === true && maint.anchorDay === 31 && maint.dueDate === nextMonthEnd, 'switched back on: last day again, anchor 31');
check((await ev(`import('./js/bills.js').then((b) => b.advanceDue(${JSON.stringify(nextMonthEnd)}, 'monthly', 31))`)) > nextMonthEnd, 'and it advances past that month end');

// Finished bills archive themselves on start-up, with Undo.
await ev(`(async () => { const s = await import('./js/store.js'); const b = s.state.bills.find((x) => x.name === 'One-off'); await s.saveBill({ ...b, recurrence: 'monthly', type: 'emi', installmentsLeft: 0 }); return true; })()`);
await send('Page.reload');
await sleep(1500);
check((await idb('bills')).find((b) => b.name === 'One-off').archivedReason === 'installments' && (await text('.toast')).includes('finished') && (await text('.toast-btn')) === 'Undo', 'a bill with 0 instalments left is archived automatically on start-up, with Undo');
await click('.toast-btn');
await sleep(300);
check(!(await idb('bills')).find((b) => b.name === 'One-off').archived, 'Undo restores it');
await ev(`(async () => { const s = await import('./js/store.js'); const b = s.state.bills.find((x) => x.name === 'One-off'); await s.saveBill({ ...b, installmentsLeft: 5 }); return true; })()`);
await nav('#/');

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
const gN = (await idb('goals')).length;
const aN = (await idb('goalAdds')).length;
const bN = (await idb('bills')).length;
check(backup.schema === 2 && backup.goals.length === gN && backup.goalAdds.length === aN && backup.bills.length === bN && gN >= 3 && aN >= 3 && bN >= 3, `the backup also holds ${gN} goals, ${aN} goal entries and ${bN} bills (schema 2)`);
check(backup.goalAdds.some((a) => a.amount < 0) && backup.goalAdds.every((a) => Number.isInteger(a.amount)) && backup.bills.every((b) => b.amount === null || Number.isInteger(b.amount)), 'goal withdrawals are negative integers; bill amounts are integer paise or null');
await click('.tabbar [data-tab=home]');
check(!(await ev(`!!document.querySelector('.banner')`)), 'backup reminder is gone after exporting');

// Import a smaller backup: the app must ask first, and Cancel must change nothing.
const small = { ...backup, entries: backup.entries.slice(0, 3) };
writeFileSync(join(WORK, 'small.json'), JSON.stringify(small));
await nav('#/settings');
const { root } = await send('DOM.getDocument');
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
await send('DOM.setFileInputFiles', { nodeId, files: [join(WORK, 'small.json')] });
await sleep(600);
check((await text('.sheet h2')) === 'Replace all your data?', 'Import asks before replacing anything');
check((await text('.sheet')).includes(`${gN} goals with ${aN} entries, and ${bN} bills`), 'Import preview shows counts for goals, their entries and bills');
await shot('11-import-confirm');
await clickText('.sheet .btn', 'Cancel');
check((await idb('entries')).length === count, 'Cancel leaves the data as it was');
await send('DOM.setFileInputFiles', { nodeId, files: [join(WORK, 'small.json')] });
await sleep(600);
await clickText('.sheet .btn', 'Replace');
await sleep(500);
check((await idb('entries')).length === 3, 'Replace imports the backup (3 entries)');
check(norm((await idb('goals')).sort((a, b) => a.order - b.order)) === norm([...backup.goals].sort((a, b) => a.order - b.order)) && (await idb('goalAdds')).length === aN && (await idb('bills')).length === bN, 'goals, goal entries and bills come back from the backup too');
// A damaged file is refused.
writeFileSync(join(WORK, 'bad.json'), JSON.stringify({ ...backup, entries: [{ ...backup.entries[0], amount: 12.5 }] }));
await nav('#/settings');
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

// ---- a backup exported from 1.0.2 (no goals or bills in it) still imports, and keeps what's here ----
const goalsHere = JSON.stringify((await idb('goals')).sort((a, b) => a.id.localeCompare(b.id)));
const addsHere = JSON.stringify((await idb('goalAdds')).sort((a, b) => a.id.localeCompare(b.id)));
const billsHere = (await idb('bills')).sort((a, b) => a.id.localeCompare(b.id));
await nav('#/settings');
const fx = (await send('DOM.querySelector', { nodeId: (await send('DOM.getDocument')).root.nodeId, selector: '#import-file' })).nodeId;
await send('DOM.setFileInputFiles', { nodeId: fx, files: [join(process.cwd(), 'tests/fixtures/backup-1.0.2.json')] });
await sleep(600);
check((await text('.sheet h2')) === 'Replace all your data?' && (await text('.sheet')).includes('3 expenses in 3 categories') && (await text('.sheet')).includes('older version') && (await text('.sheet')).includes('are kept as they are'), 'a 1.0.2 backup imports: the preview says goals and bills are kept');
await shot('25-import-old-backup');
await clickTop('Replace');
await sleep(500);
const fxCats = (await idb('categories')).sort((a, b) => a.order - b.order);
check(fxCats.map((c) => c.name).join() === 'Rent,Groceries,Old category' && (await idb('entries')).length === 3 && (await idb('entries')).some((e) => e.amount === 125050), 'the 1.0.2 backup’s categories, budgets and expenses are in');
check(JSON.stringify((await idb('goals')).sort((a, b) => a.id.localeCompare(b.id))) === goalsHere && JSON.stringify((await idb('goalAdds')).sort((a, b) => a.id.localeCompare(b.id))) === addsHere, 'goals and goal entries are exactly as they were');
const billsNow = (await idb('bills')).sort((a, b) => a.id.localeCompare(b.id));
check(billsNow.length === billsHere.length && billsNow.every((b, i) => JSON.stringify({ ...b, categoryId: 0 }) === JSON.stringify({ ...billsHere[i], categoryId: 0 }) && (b.categoryId === null || fxCats.some((c) => c.id === b.categoryId))), 'bills are kept; a link to a category that no longer exists is cleared');
check(await ev(`Promise.all([import('./js/backup.js'), import('./js/store.js')]).then(([b, s]) => b.parseBackup(JSON.stringify(s.exportData())).ok)`), 'the next export still validates (no dangling links)');

// ---- reset to starter categories: CRUX's data only; VANE's data on the same origin survives ----
const vaneSnapshot = () => ev(`(async () => {
  const dbs = {};
  for (const name of ['workout-tracker', 'vane-extra']) dbs[name] = await new Promise((ok) => { const r = indexedDB.open(name); r.onsuccess = () => { const q = r.result.transaction('sessions').objectStore('sessions').getAll(); q.onsuccess = () => { ok(q.result.map((x) => x.note)); r.result.close(); }; }; r.onerror = () => ok('error'); });
  const cache = await caches.open('workout-tracker-1.14.0');
  const cached = await cache.match('/VANE/vane-file.txt');
  return { appearance: localStorage.getItem('appearance'), nudge: localStorage.getItem('backupNudgeDismissedAt'), dbs, cachedText: cached ? await cached.text() : null, cacheNames: (await caches.keys()).filter((k) => !k.startsWith('crux-')) };
})()`);
const vaneBefore = await vaneSnapshot();
check(vaneBefore.appearance === 'dark' && vaneBefore.cachedText === 'vane cached file' && vaneBefore.dbs['workout-tracker'][0] === 'vane workout workout-tracker', 'VANE fixture is in place before the reset');
check(await ev(`localStorage.getItem('cruxLeftover') === 'crux-owned key'`), 'a crux-prefixed localStorage key exists before the reset');
const entriesBefore = (await idb('entries')).length;
const [goalsBefore, addsBefore, billsBefore] = [(await idb('goals')).length, (await idb('goalAdds')).length, (await idb('bills')).length];
await send('Page.navigate', { url: `${BASE}#/settings` });
await sleep(1200);
await shot('12-settings-reset');
// Cancel changes nothing.
await click('#reset-btn');
check((await text('.sheet h2')) === 'Reset to starter categories?', 'Reset asks for confirmation first');
check((await text('.sheet')).includes('Export a backup first') && (await text('.sheet')).includes(`${entriesBefore} expenses`), `the dialog suggests an Export and says how many expenses (${entriesBefore}) go`);
check((await text('#reset-text')).includes(`${goalsBefore} goals (with ${addsBefore} entries) and ${billsBefore} bills`), `the dialog also counts the goals (${goalsBefore}), their entries (${addsBefore}) and bills (${billsBefore}) that go`);
await shot('13-reset-confirm');
await clickText('.sheet .btn', 'Cancel');
check((await idb('entries')).length === entriesBefore, 'Cancel leaves everything as it was');
// Export first, from inside the dialog, then reset.
await click('#reset-btn');
await click('#reset-export');
await sleep(800);
check((await text('.sheet [role=status]')) === 'Backup saved. You can reset now.', 'Export from inside the dialog works');
await click('#reset-confirm');
await sleep(600);
const cats2 = (await idb('categories')).sort((a, b) => a.order - b.order);
check(JSON.stringify(cats2.map((c) => c.name)) === JSON.stringify(WANT), 'after reset: the 18 starter categories, in order');
check((await idb('entries')).length === 0, 'after reset: no expenses');
const plan2 = (await idb('budgets')).flatMap((b) => Object.values(b.plan));
check(plan2.length === 18 && plan2.every((v) => v === 0), 'after reset: every budget is ₹0');
check((await idb('budgets')).length === 1, 'after reset: a single month of budgets (no old history)');
const goals2 = (await idb('goals')).sort((a, b) => a.order - b.order);
check(goals2.map((g) => g.name).join() === 'Emergency fund,Wedding fund,Long-term investments' && goals2.every((g) => g.target === 0 && g.buckets.length === 0 && !g.archived) && (await idb('goalAdds')).length === 0 && (await idb('bills')).length === 0, 'after reset: goals and bills are cleared, the 3 starter goals are back at ₹0');
check((await idb('meta')).every((m) => m.key !== 'lastExport') && cats2.every((c) => !cats.some((o) => o.id === c.id)), 'after reset: old ids and the last-export date are gone (a fresh start)');
check(await ev(`localStorage.getItem('cruxLeftover') === null`), 'after reset: crux-prefixed localStorage keys are removed');
check(await ev(`location.hash === '#/' && document.querySelector('.hero-amt').textContent === '₹0'`), 'after reset: back on Home showing ₹0');
const vaneAfter = await vaneSnapshot();
check(JSON.stringify(vaneAfter) === JSON.stringify(vaneBefore), 'VANE’s localStorage, caches and both of its databases survive the reset untouched');
check(await ev(`indexedDB.databases().then((d) => ['workout-tracker', 'vane-extra', 'crux'].every((n) => d.some((x) => x.name === n)))`), 'all three databases (VANE’s two and CRUX’s) still exist');
check(await ev(`caches.keys().then((k) => k.some((n) => n.startsWith('crux-')))`), 'CRUX’s own app cache is untouched too, so it still works offline');
await shot('14-after-reset');

// ---- erase everything: also goals and bills, only CRUX's data, and nothing comes back on reload ----
await nav('#/settings');
await clickText('.danger-zone .btn', 'Erase all data');
check((await text('.sheet')).includes('goals') && (await text('.sheet')).includes('bills will be deleted') && (await text('.sheet')).includes('Only CRUX’s own data'), 'Erase confirms with the counts of goals and bills too');
await clickTop('Cancel');
check((await idb('goals')).length === 3 && (await idb('categories')).length === 18, 'Cancel leaves everything');
await clickText('.danger-zone .btn', 'Erase all data');
await clickTop('Erase everything');
await sleep(500);
const stores = ['categories', 'budgets', 'entries', 'goals', 'goalAdds', 'bills'];
const counts = {};
for (const st of stores) counts[st] = (await idb(st)).length;
check(stores.every((st) => counts[st] === 0), `Erase empties all six stores (${JSON.stringify(counts)})`);
check(JSON.stringify(await vaneSnapshot()) === JSON.stringify(vaneBefore), 'VANE’s data survives the erase untouched');
await send('Page.reload');
await sleep(1500);
check((await idb('categories')).length === 0 && (await idb('goals')).length === 0, 'after a reload nothing is re-seeded');

// ---- migration: a 1.0.2 install (database version 1) upgrades to version 2 without losing anything ----
await send('Page.navigate', { url: `${ORIGIN}/VANE/` });
await sleep(800);
const month = await ev(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })()`);
await ev(`(async () => {
  await new Promise((ok, no) => { const r = indexedDB.deleteDatabase('crux'); r.onsuccess = () => ok(); r.onerror = () => no(r.error); });
  await new Promise((ok, no) => {
    const r = indexedDB.open('crux', 1);
    r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('categories', { keyPath: 'id' }); db.createObjectStore('budgets', { keyPath: 'month' }); db.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date'); db.createObjectStore('meta', { keyPath: 'key' }); };
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction(['categories', 'budgets', 'entries', 'meta'], 'readwrite');
      tx.objectStore('categories').put({ id: 'old_c1', name: 'Old Rent', emoji: '🏠', color: '#3987E5', order: 0, archived: false, createdAt: 1 });
      tx.objectStore('categories').put({ id: 'old_c2', name: 'Old Food', emoji: '🛒', color: '#199E70', order: 1, archived: false, createdAt: 2 });
      tx.objectStore('budgets').put({ month: '${month}', plan: { old_c1: 1000000, old_c2: 300000 } });
      tx.objectStore('entries').put({ id: 'old_e1', amount: 125050, categoryId: 'old_c2', date: '${month}-01', note: 'kept', createdAt: 3, updatedAt: 3 });
      tx.objectStore('entries').put({ id: 'old_e2', amount: 99900, categoryId: 'old_c1', date: '${month}-02', note: '', createdAt: 4, updatedAt: 4 });
      tx.objectStore('entries').put({ id: 'old_e3', amount: 5, categoryId: 'old_c2', date: '${month}-03', note: 'five paise', createdAt: 5, updatedAt: 5 });
      tx.objectStore('meta').put({ key: 'seeded', value: 1700000000001 });
      tx.objectStore('meta').put({ key: 'lastExport', value: 1700000000000 });
      tx.oncomplete = () => { db.close(); ok(); };
    };
    r.onerror = () => no(r.error);
  });
  return true;
})()`);
await send('Page.navigate', { url: BASE });
await sleep(2500);
const dbInfo = await ev(`indexedDB.databases().then((d) => d.find((x) => x.name === 'crux'))`);
check(dbInfo.version === 2, 'migration: the database upgraded from version 1 to 2');
check(await ev(`new Promise((ok) => { const r = indexedDB.open('crux'); r.onsuccess = () => { ok(['goals', 'goalAdds', 'bills'].every((s) => r.result.objectStoreNames.contains(s))); r.result.close(); }; })`), 'migration: the goals, goalAdds and bills stores exist');
const mc = (await idb('categories')).sort((a, b) => a.order - b.order);
check(mc.map((c) => c.id).join() === 'old_c1,old_c2', 'migration: both old categories are there, and the 18 starters were not added on top');
const me = (await idb('entries')).sort((a, b) => a.id.localeCompare(b.id));
check(me.map((e) => e.amount).join() === '125050,99900,5' && me[0].note === 'kept', 'migration: every old expense is intact, to the paise');
check((await idb('budgets'))[0].plan.old_c1 === 1000000 && (await idb('meta')).find((m) => m.key === 'lastExport').value === 1700000000000, 'migration: old budgets and the last-export date are intact');
const mg = (await idb('goals')).sort((a, b) => a.order - b.order);
check(mg.map((g) => g.name).join() === 'Emergency fund,Wedding fund,Long-term investments' && mg.every((g) => g.target === 0) && (await idb('bills')).length === 0, 'migration: the three starter goals appear at ₹0, with no bills');
check((await text('.hero')).includes('₹2,249.55') && (await text('.hero')).includes('₹13,000'), 'migration: Home shows the old data (₹2,249.55 spent of ₹13,000)');
check(await ev(`Promise.all([import('./js/backup.js'), import('./js/store.js')]).then(([b, s]) => { const f = b.parseBackup(JSON.stringify(s.exportData())); return f.ok && f.counts.goals === 3 && f.counts.entries === 3; })`), 'migration: export works straight after the upgrade');
check(JSON.stringify(await vaneSnapshot()) === JSON.stringify(vaneBefore), 'VANE’s data is still untouched at the end');

check(failed.length === 0, `no failed requests${failed.length ? `: ${failed.slice(0, 3).join(', ')}` : ''}`);
const outside = requests.filter((u) => /^https?:/.test(u) && !u.startsWith(BASE) && !u.startsWith(`${ORIGIN}/VANE/`));
check(outside.length === 0, `nothing loads from outside /CRUX/${outside.length ? `: ${outside.slice(0, 3).join(', ')}` : ''}`);
check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (served at ${BASE})`);
finish(failures ? 1 : 0);
