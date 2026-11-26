// Spending maths for Home and Insights. Entries are { amount (paise), categoryId, date "YYYY-MM-DD" }.
// Pure functions: tests/insights.test.js.

import { firstDay, lastDay, sameDayLastMonth, addMonths, monthsEnding, monthOf, daysLeftInMonth } from './dates.js';
import { pctChange, pctUsed, budgetStatus } from './money.js';

/** Spend between two days inclusive: { total, byCat: { id: paise } }. */
export function spendBetween(entries, from, to) {
  const byCat = {};
  let total = 0;
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    byCat[e.categoryId] = (byCat[e.categoryId] ?? 0) + e.amount;
    total += e.amount;
  }
  return { total, byCat };
}

export const monthSpend = (entries, month) => spendBetween(entries, firstDay(month), lastDay(month));

function compareRows(cur, prev) {
  const ids = new Set([...Object.keys(cur.byCat), ...Object.keys(prev.byCat)]);
  const row = (c, p) => ({ cur: c, prev: p, diff: c - p, pct: pctChange(c, p) });
  return {
    total: row(cur.total, prev.total),
    rows: [...ids].map((id) => ({ categoryId: id, ...row(cur.byCat[id] ?? 0, prev.byCat[id] ?? 0) })),
  };
}

/**
 * Month to date vs the same days last month: 1–24 Nov against 1–24 Oct.
 * The day is clamped to last month's length, so 31 Mar compares against all of February.
 */
export function monthToDate(entries, today) {
  const month = monthOf(today);
  const prevTo = sameDayLastMonth(today);
  const current = { from: firstDay(month), to: today };
  const previous = { from: firstDay(monthOf(prevTo)), to: prevTo };
  return { current, previous, ...compareRows(spendBetween(entries, current.from, current.to), spendBetween(entries, previous.from, previous.to)) };
}

/** A whole month against the whole month before it. */
export function fullMonth(entries, month) {
  const prev = addMonths(month, -1);
  return { month, prevMonth: prev, ...compareRows(monthSpend(entries, month), monthSpend(entries, prev)) };
}

/** Months strictly before `currentMonth` that have any spending, newest first. */
export function completedMonths(entries, currentMonth) {
  const set = new Set();
  for (const e of entries) {
    const m = monthOf(e.date);
    if (m < currentMonth) set.add(m);
  }
  return [...set].sort().reverse();
}

/** n-month trend ending at `endMonth`: { months, total: [paise…], byCat: { id: [paise…] } }, oldest first. */
export function trend(entries, endMonth, n = 6) {
  const months = monthsEnding(endMonth, n);
  const index = new Map(months.map((m, i) => [m, i]));
  const total = months.map(() => 0);
  const byCat = {};
  for (const e of entries) {
    const i = index.get(monthOf(e.date));
    if (i === undefined) continue;
    total[i] += e.amount;
    (byCat[e.categoryId] ??= months.map(() => 0))[i] += e.amount;
  }
  return { months, total, byCat };
}

/**
 * Budget progress for one month's plan and spending.
 * rows: one per planned category { categoryId, budget, spent, remaining, pct, status }
 * unplanned: spending in categories that aren't in this month's plan { categoryId, spent }
 * total: the same numbers for the whole plan, counting unplanned spending as spent.
 */
export function progress(plan, spentByCat) {
  const rows = Object.entries(plan).map(([categoryId, budget]) => {
    const spent = spentByCat[categoryId] ?? 0;
    return { categoryId, budget, spent, remaining: budget - spent, pct: pctUsed(spent, budget), status: budgetStatus(spent, budget) };
  });
  const unplanned = Object.entries(spentByCat)
    .filter(([id, v]) => !(id in plan) && v > 0)
    .map(([categoryId, spent]) => ({ categoryId, spent }));
  const budget = rows.reduce((a, r) => a + r.budget, 0);
  const spent = Object.values(spentByCat).reduce((a, b) => a + b, 0);
  return { rows, unplanned, total: { budget, spent, remaining: budget - spent, pct: pctUsed(spent, budget), status: budgetStatus(spent, budget) } };
}

/**
 * What can still be spent per day for the rest of the month, today included.
 * Floors to the paise so the suggestion never adds up to more than what's left. 0 when nothing is left.
 */
export function dailyAllowance(remaining, today) {
  if (remaining <= 0) return 0;
  return Math.floor(remaining / daysLeftInMonth(today));
}

/** Entries grouped by day, newest day first, each day's entries newest first. */
export function groupByDay(entries) {
  const days = new Map();
  for (const e of [...entries].sort(byNewest)) {
    if (!days.has(e.date)) days.set(e.date, { date: e.date, total: 0, entries: [] });
    const d = days.get(e.date);
    d.total += e.amount;
    d.entries.push(e);
  }
  return [...days.values()];
}

export function byNewest(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

// ---------- the same maths over any period (calendar month or pay cycle; see periods.js) ----------
/** "To date" against the same days of the previous period: `w` comes from periods.toDate(). */
export function periodToDate(entries, w) {
  return { current: w.current, previous: w.previous, ...compareRows(spendBetween(entries, w.current.from, w.current.to), spendBetween(entries, w.previous.from, w.previous.to)) };
}

/** A whole period against the whole period before it. */
export function fullPeriod(entries, p, prev) {
  return { month: p.key, prevMonth: prev.key, period: p, prevPeriod: prev, ...compareRows(spendBetween(entries, p.from, p.to), spendBetween(entries, prev.from, prev.to)) };
}

/** Trend over a list of periods (oldest first): { months: keys, periods, total, byCat }. */
export function trendOver(entries, periods) {
  const total = periods.map(() => 0);
  const byCat = {};
  for (const e of entries) {
    const i = periods.findIndex((p) => e.date >= p.from && e.date <= p.to);
    if (i < 0) continue;
    total[i] += e.amount;
    (byCat[e.categoryId] ??= periods.map(() => 0))[i] += e.amount;
  }
  return { months: periods.map((p) => p.key), periods, total, byCat };
}

/** Keys of periods before `current` that have spending, newest first. `periodOf(ymd)` maps a date to its period. */
export function completedPeriods(entries, current, periodOf) {
  const set = new Map();
  for (const e of entries) if (e.date < current.from) { const p = periodOf(e.date); set.set(p.key, p); }
  return [...set.values()].sort((a, b) => (a.from < b.from ? 1 : -1));
}
