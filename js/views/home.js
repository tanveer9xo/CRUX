// Home: this period's spend against the plan (a calendar month or a pay cycle), a bar per category, the latest entries.
import { h, icon, badge, bar, ring, statusText } from '../ui.js';
import { needingAttention } from '../bills.js';
import { goalSummary } from '../goals.js';
import { needingConfirmation } from '../income.js';
import { formatINR } from '../money.js';
import { todayYmd, monthOf, dayLabel } from '../dates.js';
import { spendBetween, progress, periodToDate } from '../insights.js';
import { needsBackupReminder, daysSince } from '../backup.js';
import { state, planFor, catById, periods, cycleMode } from '../store.js';
import { periodTitle, salarySheet, migrationSheet, unitWord } from './cyclesui.js';
import { go } from '../router.js';
import { entryRow, emptyState, deltaPill, menuButton } from './common.js';
import { billRow } from './billflow.js';
import { sourceRow } from './income.js';
import { monthFigures, allocateSheet } from './month.js';

let backupDismissed = false; // for this session only

export const name = 'home';
export const tab = 'home';
export const title = 'Home';

export function render() {
  const today = todayYmd();
  const P = periods();
  const per = P.current();
  const month = per.key;
  const unit = unitWord();
  const spend = spendBetween(state.entries, per.from, per.to);
  const p = progress(planFor(month), spend.byCat);
  const t = p.total;
  const left = P.daysLeft(per); // until the next cycle's (predicted) start, or the end of the month
  const perDay = (rem) => (rem > 0 ? Math.floor(rem / left) : 0);

  const rows = [...p.rows].sort((a, b) => (catById(a.categoryId)?.order ?? 0) - (catById(b.categoryId)?.order ?? 0));

  return h('div', { class: 'page home' },
    h('header', { class: 'page-head' },
      h('div', { class: 'home-title' }, h('p', { class: 'eyebrow' }, 'CRUX'), h('h1', {}, per.label.split(' ')[0]), per.kind === 'cycle' ? h('p', { class: 'muted small', id: 'home-range' }, periodTitle(per).lastChild) : null),
      menuButton()),

    // 1. The month at a glance: spent against budget, a ring, and what's left per day.
    state.periodSettings.migrationPending ? h('a', { class: 'link-row cycle-invite', href: '#/', id: 'cycle-invite', onclick: (e) => { e.preventDefault(); migrationSheet(); } },
      icon('calendar-clock'), h('span', { class: 'link-row-text' }, h('strong', {}, 'Budget by pay cycle?'), h('span', { class: 'muted small' }, ' · see what would change first')), icon('right')) : null,
    h('section', { class: 'card hero', 'aria-label': `This ${unit}` },
      h('div', { class: 'summary' },
        t.budget > 0 ? ring(t.pct ?? 0, t.status, { sub: 'used' }) : null,
        h('div', { class: 'summary-text' },
          h('p', { class: 'muted small' }, `Spent this ${unit}`),
          h('p', { class: 'hero-amt num' }, formatINR(t.spent)),
          h('p', { class: 'muted' }, t.budget > 0 ? ['of ', h('span', { class: 'num strong' }, formatINR(t.budget)), ' budget'] : 'No budget set yet'))),
      h('p', { class: `hero-foot ${t.status}` },
        t.budget === 0
          ? ['Set budgets in ', h('a', { href: '#/plan' }, 'Plan'), ' to see what’s left each day.']
          : t.remaining >= 0
            ? [h('span', { class: 'num strong' }, formatINR(t.remaining)), ' left · ', h('span', { class: 'num' }, formatINR(perDay(t.remaining), { decimals: 'never' })), `/day for ${left} day${left === 1 ? '' : 's'}`]
            : [icon('alert', 'ic ic-inline'), h('span', { class: 'num strong' }, formatINR(-t.remaining)), ` over your ${formatINR(t.budget, { decimals: 'never' })} budget`]),
      cycleMode() ? h('div', { class: 'cycle-foot' },
        h('span', { class: 'muted small grow' }, `Next salary expected ${dayLabel(P.next(per).from)}`),
        h('button', { class: 'btn btn-small', type: 'button', id: 'home-salary', onclick: salarySheet }, icon('banknote'), 'Salary received')) : null),
    insightsLink(today),
    backupBanner(),

    // 2. What needs attention: bills due and income expected.
    upcomingCard(today),
    incomeExpectedCard(today),

    // 3. The plan, goals, categories and the latest entries.
    monthPlanCard(today),
    goalsStrip(today),

    h('section', { 'aria-labelledby': 'h-cats' },
      h('div', { class: 'section-head' }, h('h2', { id: 'h-cats' }, 'Categories'), h('a', { href: '#/plan', class: 'link' }, 'Edit plan')),
      rows.length || p.unplanned.length
        ? h('ul', { class: 'cat-list' },
          rows.map((r) => catRow(r, month)),
          p.unplanned.map((u) => catRow({ ...u, budget: 0, remaining: -u.spent, pct: null, status: 'over', unplanned: true }, month)))
        : emptyState('No categories yet', 'Add categories and budgets in Plan.', h('a', { class: 'btn btn-primary', href: '#/plan' }, 'Open Plan'), 'clipboard-list')),

    h('section', { 'aria-labelledby': 'h-recent' },
      h('div', { class: 'section-head' }, h('h2', { id: 'h-recent' }, 'Recent'), state.entries.length ? h('a', { href: '#/history', class: 'link' }, 'See all') : null),
      state.entries.length
        ? h('ul', { class: 'entry-list' }, state.entries.slice(0, 5).map((e) => entryRow(e, { showDate: true })))
        : emptyState('No expenses yet', 'Your latest expenses show up here.', h('a', { class: 'btn btn-primary', href: '#/add' }, icon('plus'), 'Add your first expense'), 'list')));
}

function catRow(r, month) {
  const cat = catById(r.categoryId);
  const label = r.unplanned ? 'Spent without a budget' : r.remaining >= 0 ? `${formatINR(r.remaining, { decimals: 'never' })} left` : `${formatINR(-r.remaining, { decimals: 'never' })} over`;
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

/** Shown only when something is overdue or inside its warning window. In-app: nothing is pushed. */
function upcomingCard(today) {
  const items = needingAttention(state.bills, today);
  if (!items.length) return null;
  const late = items.filter((b) => b.dueDate < today).length;
  return h('section', { class: `card upcoming ${late ? 'has-late' : ''}`, id: 'upcoming', 'aria-labelledby': 'h-upcoming' },
    h('div', { class: 'section-head' },
      h('h2', { id: 'h-upcoming' }, late ? `Upcoming · ${late} overdue` : 'Upcoming'),
      h('a', { href: '#/bills', class: 'link' }, 'All bills')),
    h('ul', { class: 'bill-list' }, items.slice(0, 3).map((b) => billRow(b, today))),
    items.length > 3 ? h('a', { href: '#/bills', class: 'link more-link' }, `+${items.length - 3} more`) : null);
}

/** One tap from Home to Insights (it moved off the tab bar): this month so far against the same days last month. */
function insightsLink(today) {
  if (!state.entries.length) return null;
  const P = periods();
  const t = periodToDate(state.entries, P.toDate(P.current())).total;
  return h('a', { class: 'link-row', href: '#/insights', id: 'insights-link' },
    h('span', { class: 'link-row-text' }, h('strong', {}, 'Insights'), h('span', { class: 'muted small' }, ` · vs the same days last ${unitWord()}`)),
    deltaPill(t.pct, t.diff), icon('right'));
}

/** Compact progress for each active goal; the whole strip opens Goals. */
function goalsStrip(today) {
  const goals = state.goals.filter((g) => !g.archived);
  if (!goals.length) return null;
  const shown = goals.slice(0, 4);
  return h('section', { class: 'goal-strip', id: 'goal-strip', 'aria-labelledby': 'h-goals' },
    h('div', { class: 'section-head' }, h('h2', { id: 'h-goals' }, 'Goals'), h('a', { href: '#/goals', class: 'link' }, goals.length > shown.length ? `See all ${goals.length}` : 'Open')),
    h('ul', { class: 'strip-list' }, shown.map((g) => {
      const s = goalSummary(g, state.goalAdds, today, periods().current());
      return h('li', {}, h('a', { class: 'strip-row', href: `#/goal/${g.id}`, 'aria-label': `${g.name}: ${formatINR(s.saved)}${s.targeted ? ` of ${formatINR(s.target)}, ${s.pct}%` : ', no target'}` },
        h('span', { class: 'strip-top' }, h('span', { class: 'strip-name' }, badge(g, 'badge badge-small'), h('span', {}, g.name)),
          h('span', { class: 'num strip-amt' }, formatINR(s.saved, { decimals: 'never' }), s.targeted ? h('span', { class: 'muted' }, ` / ${formatINR(s.target, { decimals: 'never' })}`) : null)),
        s.targeted ? h('div', { class: `bar bar-thin ${s.reached ? 'bar-done' : ''}` }, h('div', { class: 'bar-fill', style: { width: `${Math.min(100, s.pct)}%` } })) : h('span', { class: 'muted small' }, 'No target set')));
    })));
}

/** Recurring income that is due (or late): tap Received to confirm it, the same pattern as a bill's Paid. */
function incomeExpectedCard(today) {
  const items = needingConfirmation(state.incomeSources, today);
  if (!items.length) return null;
  return h('section', { class: 'card upcoming income-expected', id: 'income-expected', 'aria-labelledby': 'h-income' },
    h('div', { class: 'section-head' }, h('h2', { id: 'h-income' }, 'Income expected'), h('a', { href: '#/income', class: 'link' }, 'Income')),
    h('ul', { class: 'bill-list' }, items.slice(0, 3).map((s) => sourceRow(s, today))),
    items.length > 3 ? h('a', { href: '#/income', class: 'link more-link' }, `+${items.length - 3} more`) : null);
}

/** Compact month plan: what is unassigned (or over-planned) and what is left over, with Allocate one tap away. */
function monthPlanCard(today) {
  const { plan: p, lo } = monthFigures(periods().current(), today);
  const hasIncome = state.income.length > 0 || state.incomeSources.some((s) => !s.archived);
  if (!hasIncome) { // without any income the plan would only say "over-planned": ask for the income instead
    return h('a', { class: 'link-row', href: '#/income', id: 'month-card' }, h('span', { class: 'link-row-text' }, h('strong', {}, 'Month plan'), h('span', { class: 'muted small' }, ` · add your income to plan the ${unitWord()}`)), icon('right'));
  }
  const canAllocate = lo.leftover > 0 && state.goals.some((g) => !g.archived);
  return h('section', { class: 'card month-card', id: 'month-card', 'aria-labelledby': 'h-monthplan' },
    h('div', { class: 'section-head' }, h('h2', { id: 'h-monthplan' }, 'Month plan'), h('a', { href: '#/month', class: 'link' }, 'Open')),
    h('div', { class: 'month-stats' },
      h('div', { class: `stat ${p.over ? 'warn' : ''}`, id: 'home-unassigned' },
        h('p', { class: 'muted small' }, p.over ? 'Over-planned by' : 'Unassigned'),
        h('p', { class: 'stat-val num' }, p.over ? icon('alert', 'ic ic-inline') : null, formatINR(p.over ? p.overBy : p.unassigned, { decimals: 'never' }))),
      h('div', { class: `stat ${lo.leftover < 0 ? 'warn' : ''}`, id: 'home-leftover' },
        h('p', { class: 'muted small' }, lo.leftover < 0 ? 'Over by' : 'Leftover so far'),
        h('p', { class: 'stat-val num' }, lo.leftover < 0 ? icon('alert', 'ic ic-inline') : null, formatINR(Math.abs(lo.leftover), { decimals: 'never' })))),
    canAllocate ? h('button', { class: 'btn btn-primary', type: 'button', id: 'home-allocate', onclick: () => allocateSheet() }, icon('goals'), 'Allocate leftover') : null);
}
