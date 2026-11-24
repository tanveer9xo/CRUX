// Home: this month's spend against the plan, a bar per category, the latest entries.
import { h, icon, badge, bar, statusText } from '../ui.js';
import { formatINR } from '../money.js';
import { todayYmd, monthOf, monthName, daysLeftInMonth } from '../dates.js';
import { monthSpend, progress, dailyAllowance } from '../insights.js';
import { needsBackupReminder, daysSince } from '../backup.js';
import { state, planFor, catById } from '../store.js';
import { go } from '../router.js';
import { entryRow, emptyState } from './common.js';

let backupDismissed = false; // for this session only

export const name = 'home';
export const tab = 'home';
export const title = 'Home';

export function render() {
  const today = todayYmd();
  const month = monthOf(today);
  const spend = monthSpend(state.entries, month);
  const p = progress(planFor(month), spend.byCat);
  const t = p.total;
  const left = daysLeftInMonth(today);

  const rows = [...p.rows].sort((a, b) => (catById(a.categoryId)?.order ?? 0) - (catById(b.categoryId)?.order ?? 0));

  return h('div', { class: 'page home' },
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'CRUX'), h('h1', {}, monthName(month, false))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', onclick: () => go('#/settings') }, icon('gear'))),

    backupBanner(),

    h('section', { class: 'card hero', 'aria-label': 'This month' },
      h('p', { class: 'muted small' }, 'Spent this month'),
      h('p', { class: 'hero-amt num' }, formatINR(t.spent)),
      h('p', { class: 'muted' }, 'of ', h('span', { class: 'num strong' }, formatINR(t.budget)), ' budget', t.pct !== null ? ` · ${t.pct}%` : ''),
      bar(t.status, t.pct),
      h('p', { class: `hero-foot ${t.status}` },
        t.remaining >= 0
          ? [h('span', { class: 'num strong' }, formatINR(t.remaining)), ' left · ', h('span', { class: 'num' }, formatINR(dailyAllowance(t.remaining, today), { decimals: 'never' })), `/day for ${left} day${left === 1 ? '' : 's'}`]
          : [icon('alert', 'ic ic-inline'), h('span', { class: 'num strong' }, formatINR(-t.remaining)), ' over budget'])),

    h('section', { 'aria-labelledby': 'h-cats' },
      h('div', { class: 'section-head' }, h('h2', { id: 'h-cats' }, 'Categories'), h('a', { href: '#/plan', class: 'link' }, 'Edit plan')),
      rows.length || p.unplanned.length
        ? h('ul', { class: 'cat-list' },
          rows.map((r) => catRow(r, month)),
          p.unplanned.map((u) => catRow({ ...u, budget: 0, remaining: -u.spent, pct: null, status: 'over', unplanned: true }, month)))
        : emptyState('No categories yet', 'Add categories and budgets in Plan.', h('a', { class: 'btn', href: '#/plan' }, 'Open Plan'))),

    h('section', { 'aria-labelledby': 'h-recent' },
      h('div', { class: 'section-head' }, h('h2', { id: 'h-recent' }, 'Recent'), state.entries.length ? h('a', { href: '#/history', class: 'link' }, 'See all') : null),
      state.entries.length
        ? h('ul', { class: 'entry-list' }, state.entries.slice(0, 5).map((e) => entryRow(e, { showDate: true })))
        : emptyState('No expenses yet', 'Tap + below to add your first one. It takes three taps.')));
}

function catRow(r, month) {
  const cat = catById(r.categoryId);
  const label = r.unplanned ? 'Not in plan' : r.remaining >= 0 ? `${formatINR(r.remaining, { decimals: 'never' })} left` : `${formatINR(-r.remaining, { decimals: 'never' })} over`;
  return h('li', {},
    h('button', {
      class: `cat-row st-${r.status}`, type: 'button',
      onclick: () => go(`#/history?m=${month}&c=${r.categoryId}`),
      'aria-label': `${cat?.name}: spent ${formatINR(r.spent)} of ${formatINR(r.budget)}. ${label}. ${statusText[r.status]}`,
    },
    badge(cat),
    h('span', { class: 'cat-main' },
      h('span', { class: 'cat-top' },
        h('span', { class: 'cat-name' }, cat?.name ?? 'Unknown'),
        h('span', { class: 'cat-amt num' }, formatINR(r.spent, { decimals: 'never' }), h('span', { class: 'muted' }, ` / ${formatINR(r.budget, { decimals: 'never' })}`))),
      bar(r.status, r.pct),
      h('span', { class: 'cat-sub' }, r.status !== 'ok' && icon('alert', 'ic ic-inline'), label, r.pct !== null ? ` · ${r.pct}%` : ''))));
}

function backupBanner() {
  if (backupDismissed || !needsBackupReminder(state.lastExport ?? undefined, Date.now(), state.entries.length > 0)) return null;
  const since = Number.isFinite(state.lastExport) ? `Last backup ${daysSince(state.lastExport, Date.now())} days ago.` : 'You haven’t backed up yet.';
  const el = h('div', { class: 'banner', role: 'status' },
    icon('shield'),
    h('p', {}, h('strong', {}, 'Back up your data. '), since, ' It only lives on this device.'),
    h('div', { class: 'banner-actions' },
      h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => go('#/settings?export=1') }, 'Export'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remind me later', onclick: () => { backupDismissed = true; el.remove(); } }, icon('x'))));
  return el;
}
