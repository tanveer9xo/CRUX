// Budget periods: one interface over calendar months and pay cycles, so every screen can ask for "the current
// period", "the previous one", "the same days last period" or "days left" without caring which mode is on.
//   period: { key ("YYYY-MM": the month, or the month a cycle is named after), from, to, days, label, short, range,
//             expected (true when its start or end is only predicted), confirmed (cycle start confirmed) }
// Calendar-month mode behaves exactly as before: key = month, same-day comparison = same day of the previous month,
// clamped to its length (identical to sameDayLastMonth). Pure: tests/periods.test.js.
import { firstDay, lastDay, monthOf, addDays, addMonths, monthLabel, daysBetween, rangeLabel } from './dates.js';
import { buildCycles, cycleOf, nextRuleStart, ruleStartOnOrBefore, cycleName, previousWindow, cycleRange, MIN_GAP, ensureCycles } from './cycles.js';

function monthPeriod(m) {
  return { key: m, from: firstDay(m), to: lastDay(m), days: daysBetween(firstDay(m), lastDay(m)) + 1, label: monthLabel(m), short: monthLabel(m, { short: true }), range: rangeLabel(firstDay(m), lastDay(m)), expected: false, confirmed: true, kind: 'month' };
}

function cyclePeriod(c) {
  return { key: c.key, from: c.start, to: c.end, days: c.days, label: monthLabel(c.key), short: monthLabel(c.key, { short: true }), range: cycleRange(c), expected: !!c.expected || !!c.endExpected, startExpected: !!c.expected, endExpected: !!c.endExpected, confirmed: c.source === 'confirmed', kind: 'cycle' };
}

/** Build the period API for a mode. `records` are the stored cycle starts (cycle mode only). */
export function makePeriods({ mode = 'month', settings, records = [], today }) {
  if (mode !== 'cycle' || !records.length) {
    const of = (ymd) => monthPeriod(monthOf(ymd));
    return api(of, (key) => monthPeriod(key), 'month');
  }
  const stored = buildCycles(records, settings);
  // Cycles beyond the stored ones are predicted from the rule (marked expected).
  const predictedAfter = (last, ymd) => {
    let c = last;
    while (c.end < ymd) {
      const start = addDays(c.end, 1);
      const next = nextRuleStart(start, settings);
      c = { key: cycleName(start, addDays(next, -1)), start, end: addDays(next, -1), days: daysBetween(start, next), source: 'rule', expected: true, endExpected: true };
    }
    return c;
  };
  const predictedBefore = (first, ymd) => {
    let c = first;
    while (c.start > ymd) {
      const end = addDays(c.start, -1);
      const start = ruleStartOnOrBefore(addDays(c.start, -MIN_GAP), settings);
      c = { key: cycleName(start, end), start, end, days: daysBetween(start, end) + 1, source: 'rule', expected: true };
    }
    return c;
  };
  const of = (ymd) => {
    const c = cycleOf(stored, ymd) ?? (ymd > stored.at(-1).end ? predictedAfter(stored.at(-1), ymd) : predictedBefore(stored[0], ymd));
    return cyclePeriod(c);
  };
  const byKey = (key) => {
    const hit = stored.find((c) => c.key === key);
    if (hit) return cyclePeriod(hit);
    // A cycle named after month M holds most of M's days, so it contains the 15th (or the nearest cycle to it does).
    return of(`${key}-15`);
  };
  return api(of, byKey, 'cycle');

  function api(ofFn, byKeyFn, kind) {
    const self = {
      kind,
      of: ofFn,
      byKey: byKeyFn,
      current: () => ofFn(today),
      prev: (p) => ofFn(addDays(p.from, -1)),
      next: (p) => ofFn(addDays(p.to, 1)),
      /** The n periods ending at p, oldest first. */
      ending: (p, n) => { const out = [p]; while (out.length < n) out.unshift(self.prev(out[0])); return out; },
      /** Day number of `ymd` in its period (the first day is 1). */
      dayOf: (p, ymd) => daysBetween(p.from, ymd) + 1,
      /** Days left in p from today, today included (its last day gives 1). */
      daysLeft: (p, ymd = today) => daysBetween(ymd, p.to) + 1,
      /** Same-days window: p from its start to `ymd`, against the previous period's days 1..N (clamped). */
      toDate: (p, ymd = today) => {
        const prev = self.prev(p);
        return { current: { from: p.from, to: ymd }, previous: previousWindow({ start: prev.from, end: prev.to }, self.dayOf(p, ymd)), prevPeriod: prev };
      },
    };
    return self;
  }
}

/** Period keys sort as months ("YYYY-MM"), which budgets.js relies on. */
export const keyOf = (p) => p.key;

/**
 * What moving existing calendar-month data onto pay cycles will do, for the one-time summary shown before it is
 * applied: { cycles, first, current, budgetMonths, carriedFrom, moved, groups: [{ from, to, count, amount }] }.
 * Nothing is changed: dates stay as they are; only the period each expense counts in can change.
 */
export function migrationSummary({ budgets, entries, income, goalAdds, settings, today }) {
  const earliest = [...entries, ...income, ...goalAdds].reduce((m, x) => (x.date < m ? x.date : m), today);
  const records = ensureCycles([], settings, today, earliest).records;
  const cycles = buildCycles(records, settings);
  const P = makePeriods({ mode: 'cycle', settings, records, today });
  const groups = new Map();
  let moved = 0;
  for (const e of entries) {
    const to = P.of(e.date).key;
    const from = monthOf(e.date);
    if (to === from) continue;
    moved += 1;
    const k = `${from}>${to}`;
    const g = groups.get(k) ?? { from, to, count: 0, amount: 0 };
    g.count += 1;
    g.amount += e.amount;
    groups.set(k, g);
  }
  const budgetMonths = Object.keys(budgets).sort();
  const current = P.current();
  return {
    cycles: cycles.length,
    first: P.of(cycles[0].start),
    current,
    budgetMonths: budgetMonths.length,
    carriedFrom: budgetMonths.length && budgetMonths.at(-1) < current.key ? budgetMonths.at(-1) : null,
    moved,
    total: entries.length,
    groups: [...groups.values()].sort((a, b) => (a.from < b.from ? -1 : 1)),
  };
}
