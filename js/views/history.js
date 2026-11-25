// History: one month at a time (or all months while searching), filtered by category, grouped by day.
import { h, icon, badge } from '../ui.js';
import { formatINR } from '../money.js';
import { monthOf, todayYmd, dayLabel, isMonth, monthLabel } from '../dates.js';
import { groupByDay } from '../insights.js';
import { state, catById } from '../store.js';
import { setQuery } from '../router.js';
import { monthNav, entryRow, emptyState, pageHead } from './common.js';

export const name = 'history';
export const tab = 'history';
export const title = 'History';

let query = ''; // kept while moving between months; not put in the URL

export function render({ query: q }) {
  const month = isMonth(q.get('m')) ? q.get('m') : monthOf(todayYmd());
  const cat = q.get('c') && catById(q.get('c')) ? q.get('c') : null;
  const allMonths = q.get('all') === '1';

  const list = h('div', { class: 'history-list' });
  const summary = h('p', { class: 'muted small', 'aria-live': 'polite' });

  const draw = () => {
    const needle = query.trim().toLowerCase();
    const scopeAll = allMonths && needle;
    const rows = state.entries.filter((e) => (scopeAll || monthOf(e.date) === month)
      && (!cat || e.categoryId === cat)
      && (!needle || e.note.toLowerCase().includes(needle) || (catById(e.categoryId)?.name ?? '').toLowerCase().includes(needle)));
    const total = rows.reduce((a, e) => a + e.amount, 0);
    summary.textContent = `${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'} · ${formatINR(total)}${scopeAll ? ' · all months' : ''}`;
    const days = groupByDay(rows);
    list.replaceChildren(days.length
      ? h('div', {}, days.map((d) => h('section', { class: 'day' },
        h('h3', { class: 'day-head' }, h('span', {}, dayLabel(d.date), scopeAll ? ` ${d.date.slice(0, 4)}` : ''), h('span', { class: 'num' }, formatINR(d.total))),
        h('ul', { class: 'entry-list' }, d.entries.map((e) => entryRow(e))))))
      : needle || cat
        ? emptyState('Nothing matches', needle && !scopeAll ? 'Try searching all months.' : 'Try another category or clear the filter.', null, 'search')
        : emptyState(`No expenses in ${monthLabel(month)}`, 'Expenses you add show up here, by day.', h('a', { class: 'btn btn-primary', href: '#/add' }, icon('plus'), 'Add an expense'), 'list'));
    scopeBtn.hidden = !needle;
  };

  const search = h('input', {
    type: 'search', class: 'input search-input', placeholder: 'Search notes', 'aria-label': 'Search notes', value: query, enterkeyhint: 'search',
    oninput: () => { query = search.value; draw(); },
  });
  const scopeBtn = h('button', {
    class: 'chip chip-small', type: 'button', 'aria-pressed': String(allMonths),
    onclick: () => setQuery({ all: allMonths ? null : '1' }),
  }, 'All months');

  const filters = h('div', { class: 'chips chips-scroll', role: 'group', 'aria-label': 'Filter by category' },
    h('button', { class: 'chip chip-small', type: 'button', 'aria-pressed': String(!cat), onclick: () => setQuery({ c: null }) }, 'All'),
    state.categories.filter((c) => !c.archived || state.entries.some((e) => e.categoryId === c.id)).map((c) =>
      h('button', { class: 'chip chip-small', type: 'button', 'aria-pressed': String(c.id === cat), onclick: () => setQuery({ c: c.id === cat ? null : c.id }) },
        badge(c, 'badge badge-small'), c.name)));

  const page = h('div', { class: 'page history' },
    pageHead('History'),
    monthNav(month, (m) => setQuery({ m })),
    h('div', { class: 'search-row' }, icon('search', 'ic search-ic'), search, scopeBtn),
    filters,
    cat ? h('p', { class: 'filter-note' }, badge(catById(cat), 'badge badge-small'), ` ${catById(cat).name} only`) : null,
    summary,
    list);
  draw();
  return page;
}

export function after(main) {
  main.querySelector('.chips-scroll [aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}
