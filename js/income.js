// Income, the monthly plan, leftover, allocation and savings rate. Pure functions: tests/income.test.js.
//   income entry:  { id, sourceId|null, source (name), amount (paise > 0), date, note }
//   income source: { id, name, amount (paise|null: expected), nextDate, anchorDay, lastDay, note, archived }   (recurring, monthly)
// Income is its own list. It is never an expense and never a goal add: nothing in insights.js or budget.js imports
// this file (tests/release.test.js checks), so it cannot reach a spending total, a budget bar or a spending comparison.

import { monthOf, daysBetween, firstDay, lastDay, sameDayLastMonth, monthsEnding } from './dates.js';
import { advanceDue } from './bills.js';
import { monthSpend, spendBetween } from './insights.js';
import { monthNet } from './goals.js';

export const INCOME_WARN_DAYS = 5; // a recurring income shows on Home this many days before it is expected

const sum = (list) => list.reduce((a, x) => a + x.amount, 0);

// ---------- received / expected ----------
export const receivedBetween = (income, from, to) => sum(income.filter((i) => i.date >= from && i.date <= to));
export const receivedIn = (income, month) => receivedBetween(income, firstDay(month), lastDay(month));

/** Net money put into goals between two days (withdrawals reduce it). */
export const goalNetBetween = (goalAdds, from, to) => sum(goalAdds.filter((a) => a.date >= from && a.date <= to));
export const goalNetIn = (goalAdds, month) => goalNetBetween(goalAdds, firstDay(month), lastDay(month));

/**
 * Recurring sources still expected in a month: for the current month, those whose next expected date is this month or
 * earlier (not yet confirmed, or late); for a future month, every active source; none for a past month (what
 * arrived is in the entries). Only sources with an amount count towards expected income.
 */
export function pendingSources(sources, month, today) {
  const current = monthOf(today);
  if (month < current) return [];
  return sources.filter((s) => !s.archived && s.amount > 0 && (month > current || monthOf(s.nextDate) <= month));
}

/** { received, pending, expected }: expected = received so far + what recurring sources still promise this month. */
export function incomeForMonth(income, sources, month, today) {
  const received = receivedIn(income, month);
  const pending = sum(pendingSources(sources, month, today).map((s) => ({ amount: s.amount })));
  return { received, pending, expected: received + pending };
}

// ---------- recurring sources (same date rules as bills) ----------
export const advanceSource = (s) => advanceDue(s.nextDate, 'monthly', s.anchorDay);

/** { days, state }: 'late' (past the expected date), 'soon' (within the warning window, today included), 'later'. */
export function sourceStatus(s, today) {
  const days = daysBetween(today, s.nextDate);
  return { days, state: days < 0 ? 'late' : days <= INCOME_WARN_DAYS ? 'soon' : 'later' };
}

export const needingConfirmation = (sources, today) => sources
  .filter((s) => !s.archived && sourceStatus(s, today).state !== 'later')
  .sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : a.name.localeCompare(b.name)));

/** Confirm a recurring income received: the entry to log, and the source moved on to its next date. */
export function receiveIncome(source, { today, amount }) {
  return {
    source: { ...source, nextDate: advanceSource(source) },
    entry: { sourceId: source.id, source: source.name, amount: amount ?? source.amount, date: today, note: '' },
  };
}

/** "Not this month": the date moves on and nothing is logged. */
export const skipSource = (source) => ({ ...source, nextDate: advanceSource(source) });

// ---------- the month plan ----------
/**
 * income (expected) − category budgets − planned goal contributions = unassigned. Negative means over-planned.
 * `received` is shown beside it for what has actually arrived.
 */
export function monthPlan({ expected, received, budgetTotal, goalPlanTotal }) {
  const unassigned = expected - budgetTotal - goalPlanTotal;
  return { expected, received, budgetTotal, goalPlanTotal, unassigned, over: unassigned < 0, overBy: unassigned < 0 ? -unassigned : 0 };
}

export const plannedGoalTotal = (goals) => goals.filter((g) => !g.archived && g.monthlyPlan > 0).reduce((a, g) => a + g.monthlyPlan, 0);

// ---------- leftover and allocation ----------
/** Received − expenses logged − goal adds made, for a month. Can be negative. */
export function leftoverFor({ income, entries, goalAdds, month }) {
  const received = receivedIn(income, month);
  const spent = monthSpend(entries, month).total;
  const saved = goalNetIn(goalAdds, month);
  return { received, spent, saved, leftover: received - spent - saved };
}

/** What is still planned for a goal this month: its monthly plan minus what was already added (never below 0). */
export const plannedRemaining = (goal, goalAdds, month) => (goal.monthlyPlan > 0 ? Math.max(0, goal.monthlyPlan - monthNet(goalAdds, goal.id, month)) : 0);

/**
 * Prefill for the allocate sheet: goals in priority order (the order they are listed in) each get their remaining
 * planned amount, until the leftover runs out. A goal is cut short rather than skipped, so the total never exceeds the
 * leftover. Integer paise throughout.
 */
export function prefillAllocation(goals, goalAdds, month, leftover) {
  let room = Math.max(0, leftover);
  return goals.filter((g) => !g.archived).sort((a, b) => a.order - b.order).map((g) => {
    const give = Math.min(plannedRemaining(g, goalAdds, month), room);
    room -= give;
    return { goalId: g.id, amount: give };
  });
}

/** Check typed allocations against the leftover. amounts are integer paise (0 for blank). */
export function checkAllocation(amounts, leftover) {
  const total = amounts.reduce((a, b) => a + b, 0);
  const room = Math.max(0, leftover);
  return { total, ok: total <= room, over: Math.max(0, total - room), unassigned: room - total };
}

// ---------- savings rate and trends ----------
/** Goal adds ÷ income received as a whole percent (half away from zero); null when no income came in (no divide by zero). */
export function savingsRate(saved, received) {
  if (!(received > 0)) return null;
  const raw = (saved * 100) / received;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Percentage-point change between two rates; null if either is unknown. */
export const ratePoints = (cur, prev) => (cur === null || prev === null ? null : cur - prev);

/** Income, spending, saving and savings rate per month for the n months ending at endMonth (oldest first). */
export function incomeTrend({ income, entries, goalAdds, endMonth, n = 6 }) {
  const months = monthsEnding(endMonth, n);
  const rows = months.map((m) => {
    const received = receivedIn(income, m);
    const spent = monthSpend(entries, m).total;
    const saved = goalNetIn(goalAdds, m);
    return { month: m, income: received, spent, saved, rate: savingsRate(saved, received) };
  });
  return { months, rows, income: rows.map((r) => r.income), spent: rows.map((r) => r.spent), saved: rows.map((r) => r.saved), rate: rows.map((r) => r.rate) };
}

/** This month so far against the same days last month: income, spending, saved and savings rate. */
export function savingsMtd({ income, entries, goalAdds, today }) {
  const prevTo = sameDayLastMonth(today);
  const window = (from, to) => {
    const received = receivedBetween(income, from, to);
    const saved = goalNetBetween(goalAdds, from, to);
    return { from, to, income: received, spent: spendBetween(entries, from, to).total, saved, rate: savingsRate(saved, received) };
  };
  const current = window(firstDay(monthOf(today)), today);
  const previous = window(firstDay(monthOf(prevTo)), prevTo);
  return { current, previous, points: ratePoints(current.rate, previous.rate) };
}
