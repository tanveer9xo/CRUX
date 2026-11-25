// Start-up: open the database, roll the plan into the current month, register routes and the service worker.
import { init, ensureCurrentMonth, sweepEndedBills, restoreBills } from './store.js';
import { register, start, go, refresh } from './router.js';
import { registerServiceWorker } from './pwa.js';
import { todayYmd } from './dates.js';
import { h, toast } from './ui.js';
import * as home from './views/home.js';
import * as add from './views/add.js';
import * as historyView from './views/history.js';
import * as insights from './views/insights.js';
import * as plan from './views/plan.js';
import * as goals from './views/goals.js';
import * as bills from './views/bills.js';
import * as settings from './views/settings.js';

register('/', home);
register('/add', add);
register('/entry/:id', { name: 'edit', tab: null, isEditor: true, render: add.render, get title() { return add.title; } });
register('/history', historyView);
register('/insights', insights);
register('/plan', plan);
register('/goals', goals);
register('/goal/:id', goals.detail);
register('/bills', bills);
register('/settings', settings);

// Tab bar: render in the tap itself (see router.go), so + can focus the amount field on iOS.
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
// In-page links too.
document.getElementById('view').addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});

// A new day (or month) while the app was in the background: roll over and redraw.
let day = todayYmd();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || todayYmd() === day) return;
  day = todayYmd();
  await ensureCurrentMonth();
  if (!document.querySelector('.sheet-back') && !document.querySelector('.page.add')) refresh();
});

try {
  await init();
  // Bills that have run out (no instalments left, or past their end date) archive themselves, with an Undo.
  const swept = await sweepEndedBills();
  start();
  if (swept.length) {
    toast(swept.length === 1 ? `${swept[0].after.name} is finished and was archived.` : `${swept.length} finished bills were archived.`,
      { action: 'Undo', ms: 9000, onAction: async () => { await restoreBills(swept); refresh(); toast('Restored'); } });
  }
} catch (err) {
  console.error(err);
  document.getElementById('view').replaceChildren(h('div', { class: 'page' },
    h('h1', {}, 'CRUX couldn’t open its storage'),
    h('p', { class: 'muted' }, err?.message ?? String(err)),
    h('p', { class: 'muted' }, 'Private browsing can block storage. Open CRUX in a normal window, or close other CRUX tabs and reload.')));
} finally {
  document.documentElement.classList.remove('booting');
}
registerServiceWorker();
