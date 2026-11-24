import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthToDate, fullMonth, trend, progress, completedMonths, dailyAllowance, groupByDay, monthSpend } from '../js/insights.js';

let n = 0;
const e = (date, amount, categoryId = 'food') => ({ id: `e${n++}`, date, amount, categoryId, createdAt: n });

test('month to date compares 1–24 Nov with 1–24 Oct, per category and in total', () => {
  const entries = [
    e('2026-10-01', 10000), e('2026-10-24', 5000), e('2026-10-25', 99900), // 25 Oct is outside the window
    e('2026-10-10', 20000, 'fuel'),
    e('2026-11-02', 12000), e('2026-11-24', 6000), e('2026-11-25', 77700), // the future doesn't count
    e('2026-11-05', 10000, 'fuel'), e('2026-11-06', 3000, 'fun'),
  ];
  const r = monthToDate(entries, '2026-11-24');
  assert.deepEqual(r.current, { from: '2026-11-01', to: '2026-11-24' });
  assert.deepEqual(r.previous, { from: '2026-10-01', to: '2026-10-24' });
  assert.deepEqual(r.total, { cur: 31000, prev: 35000, diff: -4000, pct: -11 });
  const by = Object.fromEntries(r.rows.map((x) => [x.categoryId, x]));
  assert.deepEqual(by.food, { categoryId: 'food', cur: 18000, prev: 15000, diff: 3000, pct: 20 });
  assert.deepEqual(by.fuel, { categoryId: 'fuel', cur: 10000, prev: 20000, diff: -10000, pct: -50 });
  assert.equal(by.fun.pct, null); // nothing last month to compare with
});

test('month to date on the 31st compares against all of a 30-day month', () => {
  const entries = [e('2026-04-30', 1000), e('2026-05-31', 1000)];
  const r = monthToDate(entries, '2026-05-31');
  assert.deepEqual(r.previous, { from: '2026-04-01', to: '2026-04-30' });
  assert.equal(r.total.prev, 1000);
});

test('month to date on 29–31 March compares against all of February (28 or 29 days)', () => {
  const entries = [e('2026-02-28', 500), e('2028-02-29', 700)];
  for (const d of ['2026-03-29', '2026-03-30', '2026-03-31']) {
    const r = monthToDate(entries, d);
    assert.equal(r.previous.to, '2026-02-28', d);
    assert.equal(r.total.prev, 500, d);
  }
  assert.equal(monthToDate(entries, '2028-03-31').previous.to, '2028-02-29');
  assert.equal(monthToDate(entries, '2028-03-31').total.prev, 700);
  // On 28 Feb, only 1–28 January counts (not all 31 days).
  assert.equal(monthToDate([e('2026-01-29', 900)], '2026-02-28').total.prev, 0);
});

test('month to date across the year boundary', () => {
  const r = monthToDate([e('2025-12-15', 4000), e('2026-01-15', 6000)], '2026-01-20');
  assert.deepEqual(r.previous, { from: '2025-12-01', to: '2025-12-20' });
  assert.deepEqual(r.total, { cur: 6000, prev: 4000, diff: 2000, pct: 50 });
});

test('full-month comparison uses whole months of different lengths', () => {
  const entries = [e('2026-01-31', 3100), e('2026-02-28', 2800), e('2026-02-01', 200)];
  const r = fullMonth(entries, '2026-02');
  assert.equal(r.prevMonth, '2026-01');
  assert.deepEqual(r.total, { cur: 3000, prev: 3100, diff: -100, pct: -3 });
  assert.equal(monthSpend(entries, '2026-02').total, 3000);
});

test('completed months exclude the current month', () => {
  const entries = [e('2026-09-03', 1), e('2026-11-01', 1), e('2026-10-31', 1), e('2026-09-30', 1)];
  assert.deepEqual(completedMonths(entries, '2026-11'), ['2026-10', '2026-09']);
});

test('6-month trend per category and in total, across a year boundary', () => {
  const entries = [e('2025-09-30', 999), e('2025-10-01', 100), e('2025-12-31', 200), e('2026-01-01', 300, 'fun'), e('2026-03-15', 400), e('2026-04-01', 999)];
  const t = trend(entries, '2026-03', 6);
  assert.deepEqual(t.months, ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
  assert.deepEqual(t.total, [100, 0, 200, 300, 0, 400]);
  assert.deepEqual(t.byCat.food, [100, 0, 200, 0, 0, 400]);
  assert.deepEqual(t.byCat.fun, [0, 0, 0, 300, 0, 0]);
});

test('progress: used and remaining per category and in total, with unplanned spending', () => {
  const plan = { food: 100000, fuel: 50000, fun: 20000 };
  const spent = { food: 80000, fuel: 60000, gift: 5000 };
  const p = progress(plan, spent);
  const by = Object.fromEntries(p.rows.map((r) => [r.categoryId, r]));
  assert.deepEqual(by.food, { categoryId: 'food', budget: 100000, spent: 80000, remaining: 20000, pct: 80, status: 'warn' });
  assert.deepEqual(by.fuel, { categoryId: 'fuel', budget: 50000, spent: 60000, remaining: -10000, pct: 120, status: 'over' });
  assert.deepEqual(by.fun, { categoryId: 'fun', budget: 20000, spent: 0, remaining: 20000, pct: 0, status: 'ok' });
  assert.deepEqual(p.unplanned, [{ categoryId: 'gift', spent: 5000 }]);
  assert.deepEqual(p.total, { budget: 170000, spent: 145000, remaining: 25000, pct: 85, status: 'warn' });
});

test('daily allowance floors to the paise and covers today', () => {
  assert.equal(dailyAllowance(70000, '2026-11-24'), 10000); // 7 days left incl. today
  assert.equal(dailyAllowance(100, '2026-11-24'), 14); // 100/7 = 14.28 → 14, never more than what's left
  assert.equal(dailyAllowance(5000, '2026-11-30'), 5000);
  assert.equal(dailyAllowance(-1, '2026-11-24'), 0);
  assert.equal(dailyAllowance(2800, '2026-02-01'), 100); // 28-day month
  assert.equal(dailyAllowance(3100, '2026-01-01'), 100); // 31-day month
  assert.equal(dailyAllowance(3000, '2026-04-01'), 100); // 30-day month
});

test('groupByDay: newest day first, with day totals', () => {
  const g = groupByDay([e('2026-11-01', 100), e('2026-11-03', 200), e('2026-11-03', 300)]);
  assert.deepEqual(g.map((d) => [d.date, d.total, d.entries.length]), [['2026-11-03', 500, 2], ['2026-11-01', 100, 1]]);
  assert.equal(g[0].entries[0].amount, 300); // newest entry first within a day
});
