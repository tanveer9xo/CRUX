import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePeriods } from '../js/periods.js';
import { DEFAULT_PERIOD_SETTINGS, ensureCycles } from '../js/cycles.js';
import { sameDayLastMonth, monthsEnding, daysLeftInMonth } from '../js/dates.js';

const S = DEFAULT_PERIOD_SETTINGS;

test('calendar-month mode behaves exactly as before', () => {
  for (const today of ['2026-11-26', '2026-03-31', '2028-03-31', '2026-01-15', '2026-02-28', '2026-12-31']) {
    const P = makePeriods({ mode: 'month', today });
    const p = P.current();
    assert.deepEqual([p.key, p.from], [today.slice(0, 7), `${today.slice(0, 7)}-01`]);
    const w = P.toDate(p);
    assert.equal(w.previous.to, sameDayLastMonth(today), today); // identical to the old month-to-date rule
    assert.equal(P.daysLeft(p), daysLeftInMonth(today));
    assert.deepEqual(P.ending(p, 6).map((x) => x.key), monthsEnding(today.slice(0, 7), 6));
  }
});

test('cycle mode: current, previous and next cycles, with names and ranges', () => {
  const records = ensureCycles([], S, '2026-11-26', '2026-06-01').records;
  const P = makePeriods({ mode: 'cycle', settings: S, records, today: '2026-11-26' });
  const p = P.current();
  assert.deepEqual([p.key, p.label, p.range, p.from, p.to, p.days], ['2026-11', 'November 2026', '29 Oct – 26 Nov', '2026-10-29', '2026-11-26', 29]);
  assert.ok(p.endExpected); // its end depends on the predicted next salary day
  assert.equal(P.prev(p).key, '2026-10');
  const n = P.next(p);
  assert.deepEqual([n.key, n.from, n.expected], ['2026-12', '2026-11-27', true]);
  assert.equal(P.byKey('2026-09').from, '2026-08-28');
  assert.equal(P.byKey('2027-02').key, '2027-02'); // a future cycle, predicted
  assert.deepEqual(P.ending(p, 6).map((x) => x.key), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
});

test('left per day uses the days until the next (predicted) start; the last day of a cycle gives 1', () => {
  const records = ensureCycles([], S, '2026-11-26', '2026-10-01').records;
  const P = makePeriods({ mode: 'cycle', settings: S, records, today: '2026-11-26' });
  assert.equal(P.daysLeft(P.current()), 1); // 26 Nov is the last day of the November cycle
  assert.equal(P.daysLeft(P.current(), '2026-11-20'), 7);
});

test('same-day-of-cycle comparison uses day numbers across different lengths', () => {
  // November cycle 29 Oct – 26 Nov (29 days); October cycle 29 Sep – 28 Oct (30 days).
  const records = ensureCycles([], S, '2026-11-26', '2026-09-01').records;
  const P = makePeriods({ mode: 'cycle', settings: S, records, today: '2026-11-26' });
  const w = P.toDate(P.current());
  assert.deepEqual(w.current, { from: '2026-10-29', to: '2026-11-26' }); // day 29
  assert.deepEqual(w.previous, { from: '2026-09-29', to: '2026-10-27' }); // day 29 of a 30-day cycle, not all of it
  const day3 = P.toDate(P.current(), '2026-10-31');
  assert.deepEqual(day3.previous, { from: '2026-09-29', to: '2026-10-01' });
});

test('with no cycle records yet, cycle mode falls back to calendar months', () => {
  const P = makePeriods({ mode: 'cycle', settings: S, records: [], today: '2026-11-26' });
  assert.equal(P.kind, 'month');
});

test('migration summary: cycles from the earliest data, budgets copied by name, and which expenses change period', async () => {
  const { migrationSummary } = await import('../js/periods.js');
  const e = (date, amount) => ({ id: date, date, amount, categoryId: 'c' });
  const r = migrationSummary({
    budgets: { '2026-09': { c: 100 }, '2026-10': { c: 200 } },
    entries: [e('2026-09-15', 100), e('2026-09-29', 200), e('2026-09-30', 300), e('2026-10-28', 400), e('2026-10-29', 500), e('2026-11-20', 600)],
    income: [], goalAdds: [], settings: S, today: '2026-11-26',
  });
  // Cycles: 28 Aug – 28 Sep (September), 29 Sep – 28 Oct (October), 29 Oct – 26 Nov (November).
  assert.equal(r.cycles, 3);
  assert.equal(r.first.key, '2026-09');
  assert.equal(r.current.key, '2026-11');
  assert.equal(r.budgetMonths, 2);
  assert.equal(r.carriedFrom, '2026-10'); // October's budgets carry forward to the November cycle
  // 29 and 30 Sep move into the October cycle; 29 Oct moves into the November cycle.
  assert.equal(r.moved, 3);
  assert.deepEqual(r.groups.map((g) => [g.from, g.to, g.count, g.amount]), [['2026-09', '2026-10', 2, 500], ['2026-10', '2026-11', 1, 500]]);
});
