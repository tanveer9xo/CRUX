// Screen review: every main screen at several phone widths and in each theme, with design checks.
//   node tests/browser/screens.mjs                      (npm run test:screens)
//   SHOTS=/dir      save a PNG per screen/width/theme
//   WIDTHS=360,390,430   THEMES=dark,light   CHECKS=0 (screenshots only, e.g. of an older build)
// Checks per screen: no horizontal overflow, nothing spills out of its card, every control at least 44×44,
// and no emoji characters anywhere in the rendered text. Demo data is generic and lives only in this test.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../tools/build-site.mjs';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.env.SHOTS || null;
const WIDTHS = (process.env.WIDTHS || '360,390,430').split(',').map(Number);
const THEMES = (process.env.THEMES || 'dark,light').split(',');
const CHECKS = process.env.CHECKS !== '0';
const CDP = 9357;
const HTTP = 8797;
const BASE = `http://127.0.0.1:${HTTP}/CRUX/`;
const WORK = mkdtempSync(join(tmpdir(), 'crux-screens-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

buildSite(join(WORK, 'www', 'CRUX'));
const server = spawn('python3', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: join(WORK, 'www'), stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(WORK, 'profile')}`, '--no-first-run', '--no-default-browser-check',
  ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : []), 'about:blank'], { stdio: 'ignore' });
let failures = 0;
const check = (cond, msg) => { if (!cond) { console.log(`FAIL  ${msg}`); failures++; } else if (process.env.VERBOSE) console.log(`PASS  ${msg}`); };
const finish = (code) => { try { chrome.kill(); server.kill(); } catch { /* */ } setTimeout(() => { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* */ } process.exit(code); }, 300); };
process.on('exit', () => { try { chrome.kill(); server.kill(); } catch { /* */ } });
process.on('unhandledRejection', (e) => { console.error('ERROR', e); finish(2); });
setTimeout(() => { console.error('ERROR timed out'); finish(3); }, 600000).unref();

let target;
for (let i = 0; i < 200 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); } }
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  in: ${expression.slice(0, 160)}`);
  return r.result.value;
};
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
const viewport = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: true });
await viewport(390);
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// ---- generic demo data (test-only) ----
await send('Page.navigate', { url: BASE });
await sleep(2500);
await ev(`(async () => {
  const s = await import('./js/store.js');
  const d = await import('./js/dates.js');
  const today = d.todayYmd();
  const month = today.slice(0, 7);
  const cats = s.activeCategories();
  const budgets = [1500000, 350000, 400000, 800000, 0, 600000, 150000, 400000, 200000, 0, 100000, 100000, 0, 250000, 150000, 100000, 100000, 60000];
  for (const [i, c] of cats.entries()) if (budgets[i]) await s.setBudget(month, c.id, budgets[i]);
  const day = +today.slice(8);
  let k = 0;
  for (let back = 5; back >= 0; back--) {
    const m = d.addMonths(month, -back);
    const last = back === 0 ? day : +d.lastDay(m).slice(8);
    for (let dd = 1; dd <= last; dd += 2) {
      const c = cats[[3, 5, 7, 0, 1, 3, 5, 15][(dd + back + k) % 8]];
      await s.saveEntry({ amount: ((dd * 37 + back * 53 + k++ * 11) % 90 + 10) * 1000, categoryId: c.id, date: m + '-' + String(dd).padStart(2, '0'), note: k % 3 ? '' : ['weekly veg', 'team lunch', 'top-up', 'refill'][k % 4] });
    }
  }
  const g = s.state.goals;
  await s.saveGoal({ ...g[0], target: 30000000, targetDate: d.addDays(today, 500), monthlyPlan: 1500000, buckets: [{ id: 'b_sav', name: 'Savings account' }, { id: 'b_fd', name: 'FD' }] });
  await s.saveGoal({ ...g[1], target: 50000000, targetDate: d.addDays(today, 900), monthlyPlan: 1000000 });
  for (let back = 3; back >= 0; back--) {
    const m = d.addMonths(month, -back);
    await s.saveGoalAdd({ goalId: g[0].id, amount: 1500000, date: m + '-05', note: '', bucketId: back % 2 ? 'b_fd' : 'b_sav' });
    await s.saveGoalAdd({ goalId: g[1].id, amount: 800000, date: m + '-06', note: '', bucketId: null });
    await s.saveGoalAdd({ goalId: g[2].id, amount: 500000, date: m + '-07', note: '', bucketId: null });
    await s.saveIncome({ source: 'Salary', amount: 9000000, date: m + '-01', note: '', sourceId: null });
  }
  const sal = await s.saveSource({ name: 'Salary', amount: 9000000, nextDate: d.addDays(today, 3), anchorDay: +d.addDays(today, 3).slice(8), lastDay: false, note: '', archived: false });
  const bill = (o) => s.saveBill({ type: 'bill', amount: null, recurrence: 'monthly', anchorDay: +o.dueDate.slice(8), lastDay: false, warnDays: 3, endDate: null, installmentsLeft: null, note: '', categoryId: null, logExpense: true, archived: false, archivedReason: null, ...o });
  await bill({ name: 'Bike EMI', type: 'emi', amount: 350000, dueDate: d.addDays(today, -1), installmentsLeft: 9, categoryId: cats[1].id });
  await bill({ name: 'Credit card', type: 'cc', dueDate: d.addDays(today, 2), warnDays: 5, logExpense: false });
  await bill({ name: 'Internet', type: 'subscription', amount: 79900, dueDate: d.addDays(today, 12), categoryId: cats[11].id });
  await bill({ name: 'Health insurance', type: 'insurance', amount: 1800000, recurrence: 'yearly', dueDate: d.addDays(today, 80), warnDays: 14 });
  await s.markExported();
  return true;
})()`);

const SCREENS = [
  ['home', '#/'], ['add', '#/add'], ['history', '#/history'], ['insights', '#/insights'], ['insights-savings', '#/insights?t=savings'],
  ['goals', '#/goals'], ['bills', '#/bills'], ['plan', '#/plan'], ['month', '#/month'], ['income', '#/income'], ['settings', '#/settings'],
];
const EMOJI = /\p{Extended_Pictographic}/u;

for (const theme of THEMES) {
  await ev(`(() => { try { localStorage.setItem('crux-theme', ${JSON.stringify(theme)}); } catch {} return true; })()`);
  for (const w of WIDTHS) {
    await viewport(w);
    await send('Page.navigate', { url: BASE });
    await sleep(1500);
    for (const [name, hash] of SCREENS) {
      await ev(`location.hash = ${JSON.stringify(hash)}; true`);
      await sleep(600);
      await ev(`window.scrollTo(0, 0); true`);
      const tag = `${name}-${w}-${theme}`;
      if (CHECKS) {
        const r = await ev(`(() => {
          const out = { overflow: [], spill: [], small: [], emoji: [] };
          if (document.documentElement.scrollWidth > innerWidth || innerWidth !== ${w}) out.overflow.push('page ' + document.documentElement.scrollWidth + ' / ' + innerWidth);
          for (const el of document.querySelectorAll('body *')) {
            if (el.closest('.sr-only, .chips-scroll')) continue;
            const b = el.getBoundingClientRect();
            if (b.width > 2 && b.right > ${w} + 1) out.overflow.push(String(el.className?.baseVal ?? el.className) || el.tagName);
          }
          for (const c of document.querySelectorAll('main .card, main .bill-row, main .strip-row, main .cat-row, main .row')) {
            const cr = c.getBoundingClientRect();
            for (const el of c.querySelectorAll('*')) { if (el.closest('.sr-only')) continue; const b = el.getBoundingClientRect(); if (b.width > 0 && b.right > cr.right + 0.5) out.spill.push(String(el.className?.baseVal ?? el.className) || el.tagName); }
          }
          for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]):not(.sr-only), select, summary, [role=button]')) {
            if (el.closest('.sr-only') || el.disabled || el.tabIndex === -1 && el.tagName === 'INPUT') continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            if (b.width < 44 - 0.5 || b.height < 44 - 0.5) out.small.push((el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24) || el.className) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
          }
          const texts = [document.body.innerText, ...[...document.querySelectorAll('[aria-label],[title],[placeholder],input')].map((e) => (e.getAttribute('aria-label') || '') + (e.getAttribute('title') || '') + (e.getAttribute('placeholder') || '') + (e.value || ''))];
          for (const t of texts) { const m = t.match(${EMOJI}); if (m) out.emoji.push(m[0] + ' in “' + t.slice(Math.max(0, t.indexOf(m[0]) - 20), t.indexOf(m[0]) + 10).replace(/\\s+/g, ' ') + '”'); }
          return out;
        })()`);
        check(r.overflow.length === 0, `${tag}: no horizontal overflow ${r.overflow.slice(0, 3).join(', ')}`);
        check(r.spill.length === 0, `${tag}: nothing spills out of a card ${r.spill.slice(0, 3).join(', ')}`);
        check(r.small.length === 0, `${tag}: every control is at least 44×44 ${r.small.slice(0, 4).join(' | ')}`);
        check(r.emoji.length === 0, `${tag}: no emoji in rendered text ${r.emoji.slice(0, 3).join(' | ')}`);
      }
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        const full = await ev(`Math.min(document.documentElement.scrollHeight, 2600)`);
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: full, deviceScaleFactor: 2, mobile: true });
        await sleep(250);
        const s = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(SHOTS, `${tag}.png`), Buffer.from(s.data, 'base64'));
        await viewport(w);
        await sleep(150);
      }
    }
  }
}
check(errors.length === 0, `no script errors ${errors.join(' | ')}`);
console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (${THEMES.join('/')} × ${WIDTHS.join('/')} px × ${SCREENS.length} screens)`);
finish(failures ? 1 : 0);
