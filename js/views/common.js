// Pieces shared by several screens.
import { h, icon, badge } from '../ui.js';
import { formatINR } from '../money.js';
import { monthLabel, addMonths, dayLabel } from '../dates.js';
import { catById } from '../store.js';
import { go } from '../router.js';

/** ‹ November 2026 › — `min`/`max` (month keys) disable the arrows at the ends. */
export function monthNav(month, onChange, { min, max } = {}) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  return h('div', { class: 'month-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Previous month, ${monthLabel(prev)}`, disabled: !!min && prev < min, onclick: () => onChange(prev) }, icon('left')),
    h('h2', { class: 'month-nav-label', 'aria-live': 'polite' }, monthLabel(month)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Next month, ${monthLabel(next)}`, disabled: !!max && next > max, onclick: () => onChange(next) }, icon('right')));
}

/** One expense as a tappable row that opens it for editing. */
export function entryRow(e, { showDate = false } = {}) {
  const cat = catById(e.categoryId);
  const name = cat?.name ?? 'Deleted category';
  const sub = [showDate ? dayLabel(e.date) : null, e.note || null].filter(Boolean).join(' · ');
  return h('li', {},
    h('button', { class: 'entry', type: 'button', onclick: () => go(`#/entry/${e.id}`), 'aria-label': `${formatINR(e.amount)}, ${name}${sub ? `, ${sub}` : ''}. Edit` },
      badge(cat),
      h('span', { class: 'entry-text' }, h('span', { class: 'entry-cat' }, name), sub && h('span', { class: 'entry-note' }, sub)),
      h('span', { class: 'entry-amt num' }, formatINR(e.amount))));
}

/** "▲ 12%" style change pill. More spending reads as amber, less as green; always with an arrow and words. */
export function deltaPill(pct, diff) {
  if (pct === null) return h('span', { class: 'pill pill-new', title: 'Nothing to compare with last month' }, 'New');
  if (diff === 0) return h('span', { class: 'pill pill-flat' }, 'Same');
  const up = diff > 0;
  return h('span', { class: `pill ${up ? 'pill-up' : 'pill-down'}`, 'aria-label': `${Math.abs(pct)}% ${up ? 'more' : 'less'}` },
    up ? '▲' : '▼', ` ${Math.abs(pct)}%`);
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), text && h('p', { class: 'muted' }, text), action);
}

export const pageHead = (title, ...extra) => h('header', { class: 'page-head' }, h('h1', {}, title), ...extra);
