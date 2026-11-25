// Insights: month to date vs last month, full-month comparisons with a 6-month trend, budget progress.
import { h, icon, badge, bar, svgEl, statusText } from '../ui.js';
import { formatINR, formatCompact } from '../money.js';
import { todayYmd, monthOf, addMonths, rangeLabel, monthLabel, monthName, daysLeftInMonth, isMonth } from '../dates.js';
import { monthToDate, fullMonth, trend, progress, monthSpend, dailyAllowance, completedMonths } from '../insights.js';
import { savedInMonth } from '../goals.js';
import { savingsMtd, incomeTrend } from '../income.js';
import { state, planFor, catById } from '../store.js';
import { setQuery } from '../router.js';
import { monthNav, deltaPill, emptyState, pageHead } from './common.js';

export const name = 'insights';
export const tab = null;
export const title = 'Insights';

const TABS = [['mtd', 'This month'], ['months', 'Months'], ['budget', 'Budget'], ['savings', 'Savings']];

export function render({ query }) {
  const t = TABS.some(([k]) => k === query.get('t')) ? query.get('t') : 'mtd';
  const today = todayYmd();
  const body = t === 'mtd' ? mtdView(today) : t === 'months' ? monthsView(today, query.get('m')) : t === 'savings' ? savingsView(today) : budgetView(today);
  return h('div', { class: 'page insights' },
    pageHead('Insights'),
    h('div', { class: 'segmented seg4', role: 'tablist', 'aria-label': 'Insight' },
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

// ---------- savings: income, spending and saving, kept out of every spending figure above ----------
const SERIES = [['income', 'Income', '#199E70'], ['spent', 'Spent', '#D95926'], ['saved', 'Saved', '#3987E5']];
const rateText = (r) => (r === null ? '—' : `${r}%`);

/** Percentage-point change in savings rate. More saving is the good direction, so it is green going up. */
function ratePill(points) {
  if (points === null) return h('span', { class: 'pill pill-new', title: 'No income to compare with' }, 'No comparison');
  if (points === 0) return h('span', { class: 'pill pill-flat' }, 'Same');
  return h('span', { class: `pill ${points > 0 ? 'pill-down' : 'pill-up'}`, 'aria-label': `${Math.abs(points)} percentage points ${points > 0 ? 'higher' : 'lower'}` }, icon(points > 0 ? 'arrow-up' : 'arrow-down'), `${Math.abs(points)} pts`);
}

function savingsView(today) {
  const mtd = savingsMtd({ income: state.income, entries: state.entries, goalAdds: state.goalAdds, today });
  const tr = incomeTrend({ income: state.income, entries: state.entries, goalAdds: state.goalAdds, endMonth: monthOf(today), n: 6 });
  const cur = rangeLabel(mtd.current.from, mtd.current.to);
  const prev = rangeLabel(mtd.previous.from, mtd.previous.to);
  const money = (v) => formatINR(v, { decimals: 'never' });
  const row = (label, a, b) => h('li', { class: 'cmp-row' }, h('span', { class: 'cmp-name' }, label), h('span', { class: 'cmp-vals' }, h('span', { class: 'num strong' }, money(a)), h('span', { class: 'num muted small' }, `was ${money(b)}`)));
  return h('div', { role: 'tabpanel', id: 'savings-panel' },
    h('p', { class: 'muted small lede' }, `${cur} compared with ${prev}. Savings rate = money added to goals ÷ income received.`),
    h('section', { class: 'card cmp-total' },
      h('div', { class: 'cmp-total-row' },
        h('div', {}, h('p', { class: 'muted small' }, `Savings rate ${cur}`), h('p', { class: 'hero-amt num', id: 'rate-now' }, rateText(mtd.current.rate))),
        ratePill(mtd.points)),
      h('p', { class: 'muted' }, `${prev}: `, h('span', { class: 'num strong', id: 'rate-prev' }, rateText(mtd.previous.rate))),
      mtd.current.rate === null ? h('p', { class: 'muted small' }, 'No income received yet this month, so there’s no rate to show.') : null),
    h('ul', { class: 'cmp-list' }, row('Income received', mtd.current.income, mtd.previous.income), row('Spent', mtd.current.spent, mtd.previous.spent), row('Saved to goals', mtd.current.saved, mtd.previous.saved)),
    h('section', { 'aria-labelledby': 'h-inc-trend' },
      h('h2', { id: 'h-inc-trend' }, `Income, spent and saved · 6 months to ${monthLabel(tr.months.at(-1), { short: true })}`),
      h('div', { class: 'card' }, groupedChart(tr)),
      h('table', { class: 'rate-table', id: 'rate-table' }, h('caption', { class: 'sr-only' }, 'Income, spent, saved and savings rate by month'),
        h('thead', {}, h('tr', {}, ['Month', 'Income', 'Spent', 'Saved', 'Rate'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, [...tr.rows].reverse().map((r) => h('tr', {
          title: 'Tap for the full figures',
          onclick: (e) => {
            e.currentTarget.parentElement.querySelectorAll('tr').forEach((row) => row.removeAttribute('aria-selected'));
            e.currentTarget.setAttribute('aria-selected', 'true');
            const out = document.getElementById('trend-readout');
            if (out) out.textContent = `${monthLabel(r.month, { short: true })}: income ${formatINR(r.income)} · spent ${formatINR(r.spent)} · saved ${formatINR(r.saved)} · rate ${rateText(r.rate)}`;
          },
        }, h('th', { scope: 'row' }, monthName(r.month)), h('td', { class: 'num' }, formatCompact(r.income)), h('td', { class: 'num' }, formatCompact(r.spent)), h('td', { class: 'num' }, formatCompact(r.saved)), h('td', { class: 'num strong' }, rateText(r.rate))))))),
      h('p', { class: 'muted small' }, 'Short forms like ₹1.2L keep the table compact: tap a month for the exact amounts.'));
}

/** Three bars per month (income, spent, saved). A legend names the series; tap a month for its exact figures. */
function groupedChart(tr) {
  const W = 300;
  const H = 150;
  const top = 8;
  const bottom = 18;
  const max = Math.max(...tr.income, ...tr.spent, ...tr.saved, 1);
  const slot = W / tr.months.length;
  const bw = Math.min(12, (slot - 8) / 3);
  const plotH = H - top - bottom;
  const readout = h('p', { class: 'chart-readout num', id: 'trend-readout', 'aria-live': 'polite' }, `Tap a month for its figures`);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Income, spent and saved by month' });
  svg.append(svgEl('line', { x1: 0, x2: W, y1: H - bottom + 0.5, y2: H - bottom + 0.5, class: 'axis' }));
  const marks = [];
  tr.months.forEach((m, i) => {
    const gx = i * slot + (slot - bw * 3 - 4) / 2;
    SERIES.forEach(([key, , color], k) => {
      const v = tr[key][i];
      const bh = v > 0 ? Math.max(2, (v / max) * plotH) : 0;
      const x = gx + k * (bw + 2);
      const y = H - bottom - bh;
      const r = Math.min(3, bw / 2, bh);
      const mark = svgEl('path', { d: bh > 0 ? `M${x} ${H - bottom}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${H - bottom}Z` : '', fill: color, class: 'bar-mark' });
      mark.dataset.month = m;
      marks.push(mark);
      svg.append(mark);
    });
    const hit = svgEl('rect', { x: i * slot, y: 0, width: slot, height: H, fill: 'transparent', class: 'hit' });
    const pick = () => {
      readout.textContent = `${monthLabel(m, { short: true })}: income ${formatINR(tr.income[i], { decimals: 'never' })} · spent ${formatINR(tr.spent[i], { decimals: 'never' })} · saved ${formatINR(tr.saved[i], { decimals: 'never' })} · rate ${rateText(tr.rate[i])}`;
      marks.forEach((mk) => mk.classList.toggle('dim', mk.dataset.month !== m));
    };
    hit.addEventListener('pointerenter', pick);
    hit.addEventListener('click', pick);
    svg.append(hit, svgEl('text', { x: i * slot + slot / 2, y: H - 4, class: 'tick', 'text-anchor': 'middle' }, monthName(m)));
  });
  svg.addEventListener('pointerleave', () => marks.forEach((mk) => mk.classList.remove('dim')));
  const legend = h('ul', { class: 'legend', 'aria-label': 'Legend' }, SERIES.map(([, label, color]) => h('li', {}, h('span', { class: 'dot', style: { '--c': color }, 'aria-hidden': 'true' }), label)));
  return h('div', { class: 'chart-wrap' }, legend, readout, svg);
}
