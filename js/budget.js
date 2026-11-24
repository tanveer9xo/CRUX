// Budgets per month. A month's plan is exactly the categories in its budget record, each with an amount in paise:
//   budgets = { "2026-10": { cat_a: 800000, cat_b: 300000 }, "2026-11": { ... } }
// Rules:
//  - A month without a record uses the latest earlier record (what it would have had after a rollover).
//  - A month before the first record has no plan.
//  - rollover() writes the current month's record by copying forward, so later edits can't reach back.
//  - setBudget(from, …) changes `from` and every recorded month after it, never a month before it.
// Pure functions that return new objects (inputs are not mutated): tests/budget.test.js.

/** The record that applies to `month`: its own, else the latest earlier one, else null. */
export function recordMonthFor(budgets, month) {
  let best = null;
  for (const k of Object.keys(budgets)) if (k <= month && (best === null || k > best)) best = k;
  return best;
}

/** The plan for `month` as a fresh { categoryId: paise } object ({} when there is none). */
export function budgetsFor(budgets, month) {
  const k = recordMonthFor(budgets, month);
  return k ? { ...budgets[k] } : {};
}

/**
 * Make sure `month` has its own record, copying forward from the latest earlier month.
 * Returns { budgets, created }. Months skipped in between need no record: they resolve to the same copy.
 */
export function rollover(budgets, month) {
  if (budgets[month]) return { budgets, created: false };
  const prev = recordMonthFor(budgets, month);
  if (!prev) return { budgets, created: false };
  return { budgets: { ...budgets, [month]: { ...budgets[prev] } }, created: true };
}

/**
 * Set one category's budget from `fromMonth` onward. `paise === null` takes it out of the plan (archive).
 * Months before `fromMonth` keep exactly what they had.
 */
export function setBudget(budgets, fromMonth, categoryId, paise) {
  const next = { ...budgets };
  if (!next[fromMonth]) next[fromMonth] = budgetsFor(budgets, fromMonth);
  for (const k of Object.keys(next)) {
    if (k < fromMonth) continue;
    const rec = { ...next[k] };
    if (paise === null) delete rec[categoryId];
    else rec[categoryId] = paise;
    next[k] = rec;
  }
  return next;
}

export const totalBudget = (plan) => Object.values(plan).reduce((a, b) => a + b, 0);
