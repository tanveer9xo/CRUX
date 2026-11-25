// Insights: month to date vs last month, full-month comparisons with a 6-month trend, budget progress.
import { h, icon, badge, bar, svgEl, statusText } from '../ui.js';
import { formatINR, formatCompact } from '../money.js';
import { todayYmd, monthOf, addMonths, rangeLabel, monthLabel, monthName, daysLeftInMonth, isMonth } from '../dates.js';
import { monthToDate, fullMonth, trend, progress, monthSpend, dailyAllowance, completedMonths } from '../insights.js';
import { savedInMonth } from '../goals.js';
import { state, planFor, catById } from '../store.js';
import { setQuery } from '../router.js';
import { monthNav, deltaPill, emptyState, pageHead } from './common.js';

export const name = 'insights';
export const tab = null;
export const title = 'Insights';

const TABS = [['mtd', 'Month to date'], ['months', 'Months'], ['budget', 'Budget']];

export function render({ query }) {
  const t = TABS.some(([k]) => k === query.get('t')) ? query.get('t') : 'mtd';
  const today = todayYmd();
  const body = t === 'mtd' ? mtdView(today) : t === 'months' ? monthsView(today, query.get('m')) : budgetView(today);
  return h('div', { class: 'page insights' },
    pageHead('Insights'),
    h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Insight' },
      TABS.map(([k, label]) => h('button', { class: 'seg', type: 'button', role: 'tab', 'aria-selected': String(k === t), onclick: () => setQuery({ t: k, m: null }) }, label))),
    body);
}

const order = (id) => catById(id)?.order ?? 1e9;

/** Category rows comparing two periods. */
function compareList(rows) {
  const sorted = [...rows].sort((a, b) => b.cur - a.cur || b.prev - a.prev || order(a.categoryId) - order(b.categoryId));
  return h('ul', { class: 'cmp-list' }, sorted.map((r) => {
    const cat = catById(r.categoryId);
    return h('li', { class: 'cmp-row' },
      badge(cat),
      h('span', { class: 'cmp-name' }, cat?.name ?? 'Unknown'),
      h('span', { class: 'cmp-vals' },
        h('span', { class: 'num strong' }, formatINR(r.cur, { decimals: 'never' })),
        h('span', { class: 'num muted small' }, `was ${formatINR(r.prev, { decimals: 'never' })}`)),
      deltaPill(r.pct, r.diff));
  }));
}

function totalCompare(total, curLabel, prevLabel) {
  return h('section', { class: 'card cmp-total' },
    h('div', { class: 'cmp-total-row' },
      h('div', {}, h('p', { class: 'muted small' }, curLabel), h('p', { class: 'hero-amt num' }, formatINR(total.cur, { decimals: 'never' }))),
      deltaPill(total.pct, total.diff)),
    h('p', { class: 'muted' }, `${prevLabel}: `, h('span', { class: 'num strong' }, formatINR(total.prev, { decimals: 'never' })),
      total.diff ? [' · ', h('span', { class: 'num' }, formatINR(total.diff, { sign: true, decimals: 'never' }))] : null));
}

function mtdView(today) {
  const r = monthToDate(state.entries, today);
  const cur = rangeLabel(r.current.from, r.current.to);
  const prev = rangeLabel(r.previous.from, r.previous.to);
  return h('div', { role: 'tabpanel' },
    h('p', { class: 'muted small lede' }, `${cur} compared with ${prev}.`),
    totalCompare(r.total, `Spent ${cur}`, prev),
    // Money put into goals. Kept out of every spending figure on this screen.
    h('p', { class: 'saved-line', id: 'insights-saved' }, h('span', { class: 'muted' }, 'Saved this month: '), h('strong', { class: 'num' }, formatINR(savedInMonth(state.goalAdds, monthOf(today)))),
      h('a', { class: 'link', href: '#/goals' }, 'Goals')),
    r.rows.length ? h('section', {}, h('h2', {}, 'By category'), compareList(r.rows)) : emptyState('Nothing to compare yet', 'Add expenses and this fills in.'));
}

function monthsView(today, m) {
  const current = monthOf(today);
  const done = completedMonths(state.entries, current);
  if (!done.length) return h('div', { role: 'tabpanel' }, emptyState('No completed months yet', 'Full-month comparisons appear once a month with expenses has ended.'));
  const month = isMonth(m) && m < current ? m : done[0];
  const r = fullMonth(state.entries, month);
  const tr = trend(state.entries, month, 6);
  const cats = Object.keys(tr.byCat).sort((a, b) => order(a) - order(b));
  return h('div', { role: 'tabpanel' },
    monthNav(month, (mm) => setQuery({ m: mm }), { max: addMonths(current, -1) }),
    totalCompare(r.total, `Spent in ${monthLabel(month)}`, monthLabel(r.prevMonth)),
    r.rows.length ? h('section', {}, h('h2', {}, `By category vs ${monthName(r.prevMonth, false)}`), compareList(r.rows)) : null,
    h('section', { 'aria-labelledby': 'h-trend' },
      h('h2', { id: 'h-trend' }, `6 months to ${monthLabel(month, { short: true })}`),
      h('div', { class: 'card' }, h('p', { class: 'muted small' }, 'Total'), barChart(tr.months, tr.total, 'var(--accent)', 'Total', true)),
      h('div', { class: 'multiples' }, cats.map((id) => {
        const cat = catById(id);
        return h('div', { class: 'card mini' },
          h('p', { class: 'mini-head' }, badge(cat, 'badge badge-small'), h('span', {}, cat?.name ?? 'Unknown')),
          barChart(tr.months, tr.byCat[id], cat?.color ?? '#7C8796', cat?.name ?? 'Unknown', false));
      }))));
}

/**
 * A single-series bar chart (one colour, so no legend). Tap or hover a bar to read its value; the latest
 * value is labelled. A visually hidden table carries every value for screen readers.
 */
function barChart(months, values, color, label, big) {
  const W = 300;
  const H = big ? 150 : 84;
  const top = 18;
  const bottom = 18;
  const max = Math.max(...values, 1);
  const slot = W / months.length;
  const bw = Math.min(big ? 30 : 22, slot - 8);
  const readout = h('p', { class: 'chart-readout num', 'aria-hidden': 'true' }, `${monthLabel(months.at(-1), { short: true })}: ${formatINR(values.at(-1), { decimals: 'never' })}`);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${label}, last 6 months` });
  const plotH = H - top - bottom;
  svg.append(svgEl('line', { x1: 0, x2: W, y1: H - bottom + 0.5, y2: H - bottom + 0.5, class: 'axis' }));
  const marks = [];
  months.forEach((m, i) => {
    const v = values[i];
    const bh = v > 0 ? Math.max(2, (v / max) * plotH) : 0;
    const x = i * slot + (slot - bw) / 2;
    const y = H - bottom - bh;
    const r = Math.min(4, bw / 2, bh);
    // Rounded at the data end only, square on the baseline.
    const d = bh > 0 ? `M${x} ${H - bottom}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${H - bottom}Z` : '';
    const mark = svgEl('path', { d, fill: color, class: 'bar-mark' });
    marks.push(mark);
    const hit = svgEl('rect', { x: i * slot, y: 0, width: slot, height: H, fill: 'transparent', class: 'hit' });
    const pick = () => {
      readout.textContent = `${monthLabel(m, { short: true })}: ${formatINR(v, { decimals: 'never' })}`;
      marks.forEach((mk, j) => mk.classList.toggle('dim', j !== i));
    };
    hit.addEventListener('pointerenter', pick);
    hit.addEventListener('click', pick);
    svg.append(mark, hit, svgEl('text', { x: i * slot + slot / 2, y: H - 4, class: 'tick', 'text-anchor': 'middle' }, monthName(m)));
    if (i === months.length - 1 && v > 0) svg.append(svgEl('text', { x: x + bw / 2, y: y - 5, class: 'val', 'text-anchor': 'middle' }, formatCompact(v)));
  });
  svg.addEventListener('pointerleave', () => marks.forEach((mk) => mk.classList.remove('dim')));
  // In a hidden div: a table ignores the 1px width that hides it, and would widen the page.
  const table = h('div', { class: 'sr-only' }, h('table', {}, h('caption', {}, label),
    h('tbody', {}, months.map((m, i) => h('tr', {}, h('th', { scope: 'row' }, monthLabel(m)), h('td', {}, formatINR(values[i])))))));
  return h('div', { class: 'chart-wrap' }, readout, svg, table);
}

function budgetView(today) {
  const month = monthOf(today);
  const plan = planFor(month);
  const p = progress(plan, monthSpend(state.entries, month).byCat);
  const t = p.total;
  const days = daysLeftInMonth(today);
  const rows = [...p.rows].sort((a, b) => order(a.categoryId) - order(b.categoryId));
  if (!rows.length && !p.unplanned.length) return h('div', { role: 'tabpanel' }, emptyState('No budget for this month', 'Set budgets in Plan.', h('a', { class: 'btn', href: '#/plan' }, 'Open Plan')));
  return h('div', { role: 'tabpanel' },
    h('p', { class: 'muted small lede' }, `${monthLabel(month)} · ${days} day${days === 1 ? '' : 's'} left, today included.`),
    h('section', { class: 'card' },
      h('div', { class: 'prog-grid' },
        stat('Used', formatINR(t.spent, { decimals: 'never' }), t.pct !== null ? `${t.pct}% of ${formatINR(t.budget, { decimals: 'never' })}` : 'No budget'),
        stat(t.remaining >= 0 ? 'Remaining' : 'Over by', formatINR(Math.abs(t.remaining), { decimals: 'never' }), t.remaining > 0 ? `${formatINR(dailyAllowance(t.remaining, today), { decimals: 'never' })} a day` : statusText[t.status] || '—')),
      bar(t.status, t.pct)),
    h('ul', { class: 'prog-list' },
      rows.map((r) => progRow(r, today)),
      p.unplanned.map((u) => progRow({ ...u, budget: 0, remaining: -u.spent, pct: null, status: 'over', unplanned: true }, today))));
}

const stat = (label, value, sub) => h('div', { class: 'stat' }, h('p', { class: 'muted small' }, label), h('p', { class: 'stat-val num' }, value), h('p', { class: 'muted small' }, sub));

function progRow(r, today) {
  const cat = catById(r.categoryId);
  const right = r.unplanned ? 'Not in plan' : r.remaining >= 0 ? `${formatINR(r.remaining, { decimals: 'never' })} left` : `${formatINR(-r.remaining, { decimals: 'never' })} over`;
  return h('li', { class: `prog-row st-${r.status}` },
    h('div', { class: 'prog-top' }, badge(cat), h('span', { class: 'cmp-name' }, cat?.name ?? 'Unknown'), h('span', { class: 'num strong' }, r.pct !== null ? `${r.pct}%` : '—')),
    bar(r.status, r.pct),
    h('div', { class: 'prog-foot' },
      h('span', { class: 'num muted' }, `${formatINR(r.spent, { decimals: 'never' })} of ${formatINR(r.budget, { decimals: 'never' })}`),
      h('span', { class: `num prog-left ${r.status}` }, r.status !== 'ok' ? icon('alert', 'ic ic-inline') : null, right,
        !r.unplanned && r.remaining > 0 ? h('span', { class: 'muted' }, ` · ${formatINR(dailyAllowance(r.remaining, today), { decimals: 'never' })}/day`) : null)));
}
