// Goal maths (savings and investments). Pure functions: tests/goals.test.js.
//   goal: { id, name, emoji, target (paise, 0/null = none), targetDate "YYYY-MM-DD"|null, monthlyPlan (paise, 0/null = none),
//           buckets: [{ id, name }], archived, order }
//   add:  { id, goalId, amount (signed paise: negative = withdrawal), date, note, bucketId|null }
// Goal adds are a separate list from expenses. Nothing here, and nothing in insights.js or budget.js, mixes them:
// they never count toward spending, budgets, month-to-date or trends (tests/release.test.js checks the imports).

import { monthOf, daysBetween, monthsInclusive, firstDay, lastDay } from './dates.js';
import { pctUsed } from './money.js';

export const hasTarget = (g) => Number.isSafeInteger(g.target) && g.target > 0;
export const hasPlan = (g) => Number.isSafeInteger(g.monthlyPlan) && g.monthlyPlan > 0;

const sum = (list) => list.reduce((a, x) => a + x.amount, 0);

export const addsFor = (goalAdds, goalId) => goalAdds.filter((a) => a.goalId === goalId);

/** Net saved in a goal (adds minus withdrawals), optionally for one bucket (null = no bucket). */
export function savedAmount(goalAdds, goalId, bucketId) {
  const own = addsFor(goalAdds, goalId);
  return sum(bucketId === undefined ? own : own.filter((a) => (a.bucketId ?? null) === bucketId));
}

/** A calendar month ("YYYY-MM") or a period ({ from, to }) as a date range. */
export const rangeOf = (x) => (typeof x === 'string' ? { from: firstDay(x), to: lastDay(x) } : x);
const within = (a, r) => a.date >= r.from && a.date <= r.to;

/** Net added to one goal during a month or period (withdrawals reduce it). */
export const monthNet = (goalAdds, goalId, period) => { const r = rangeOf(period); return sum(addsFor(goalAdds, goalId).filter((a) => within(a, r))); };

/** Net saved in a month or period across every goal: the "Saved this month/cycle" line. */
export const savedInMonth = (goalAdds, period) => { const r = rangeOf(period); return sum(goalAdds.filter((a) => within(a, r))); };

/**
 * Per-month saving needed to reach the target by the target date. Counts the current month and the target month,
 * since money can still be added in both. Rounds up to the paise so the plan never falls short.
 * Only when both a target and a target date are set. state: 'ok' | 'done' (nothing left) | 'past' (date has gone).
 */
export function neededPerMonth(goal, saved, today) {
  if (!hasTarget(goal) || !goal.targetDate) return null;
  const remaining = Math.max(0, goal.target - saved);
  if (remaining === 0) return { state: 'done', perMonth: 0, monthsLeft: 0 };
  if (goal.targetDate < today) return { state: 'past', perMonth: null, monthsLeft: 0, daysLate: daysBetween(goal.targetDate, today) };
  const monthsLeft = monthsInclusive(monthOf(today), monthOf(goal.targetDate));
  return { state: 'ok', perMonth: Math.ceil(remaining / monthsLeft), monthsLeft };
}

/** Where a goal's money sits: one row per bucket, plus "Unassigned" when money was added without one. */
export function bucketSplit(goal, goalAdds) {
  const rows = goal.buckets.map((b) => ({ id: b.id, name: b.name, amount: savedAmount(goalAdds, goal.id, b.id) }));
  const loose = savedAmount(goalAdds, goal.id, null);
  if (loose !== 0 || !goal.buckets.length) rows.push({ id: null, name: 'Unassigned', amount: loose });
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? Math.round((r.amount * 100) / total) : null }));
}

/** Most that can be withdrawn from a bucket (null = no bucket); `excludeId` ignores an add being edited. */
export function maxWithdrawal(goalAdds, goalId, bucketId, excludeId = null) {
  return Math.max(0, sum(addsFor(goalAdds, goalId).filter((a) => a.id !== excludeId && (a.bucketId ?? null) === (bucketId ?? null))));
}

/** Everything a goal card shows. `period` (a month key or { from, to }) is "this month/cycle"; default: today's month. */
export function goalSummary(goal, goalAdds, today, period = monthOf(today)) {
  const saved = savedAmount(goalAdds, goal.id);
  const targeted = hasTarget(goal);
  const month = period;
  const added = monthNet(goalAdds, goal.id, month);
  return {
    saved,
    targeted,
    target: targeted ? goal.target : null,
    pct: targeted ? Math.max(0, pctUsed(saved, goal.target)) : null,
    remaining: targeted ? Math.max(0, goal.target - saved) : null,
    reached: targeted && saved >= goal.target,
    month: { added, plan: hasPlan(goal) ? goal.monthlyPlan : null, pct: hasPlan(goal) ? Math.max(0, pctUsed(added, goal.monthlyPlan)) : null },
    needed: neededPerMonth(goal, saved, today),
    buckets: goal.buckets.length ? bucketSplit(goal, goalAdds) : [], // a split only where buckets exist
  };
}
