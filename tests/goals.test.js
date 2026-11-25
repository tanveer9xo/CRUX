import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goalSummary, neededPerMonth, savedAmount, savedInMonth, monthNet, bucketSplit, maxWithdrawal, hasTarget } from '../js/goals.js';
import { monthSpend, monthToDate, trend, progress } from '../js/insights.js';

let n = 0;
const add = (goalId, date, amount, bucketId = null) => ({ id: `a${n++}`, goalId, date, amount, bucketId, note: '', createdAt: n });
const goal = (over = {}) => ({ id: 'g1', name: 'Emergency fund', emoji: '🛟', target: 1000000, targetDate: null, monthlyPlan: 0, buckets: [], archived: false, order: 0, ...over });

test('saved so far, % of target and remaining', () => {
  const adds = [add('g1', '2026-09-10', 250000), add('g1', '2026-10-10', 250000), add('g2', '2026-10-10', 999)];
  const s = goalSummary(goal(), adds, '2026-11-25');
  assert.equal(s.saved, 500000);
  assert.equal(s.pct, 50);
  assert.equal(s.remaining, 500000);
  assert.equal(s.reached, false);
});

test('percent rounds down, so 79.9 % never reads as 80 %', () => {
  assert.equal(goalSummary(goal({ target: 100000 }), [add('g1', '2026-11-01', 79999)], '2026-11-25').pct, 79);
});

test('past the target: over 100 %, nothing remaining, reached', () => {
  const s = goalSummary(goal({ target: 100000 }), [add('g1', '2026-11-01', 150000)], '2026-11-25');
  assert.deepEqual([s.pct, s.remaining, s.reached], [150, 0, true]);
});

test('a goal with no target (₹0 or null) has no percent or remaining, only the saved amount', () => {
  for (const target of [0, null]) {
    const g = goal({ target });
    assert.equal(hasTarget(g), false);
    const s = goalSummary(g, [add('g1', '2026-11-01', 500)], '2026-11-25');
    assert.deepEqual([s.saved, s.targeted, s.pct, s.remaining, s.needed], [500, false, null, null, null]);
  }
});

test('a withdrawal is a negative add: it lowers saved and this month’s net', () => {
  const adds = [add('g1', '2026-11-02', 300000), add('g1', '2026-11-10', -120000)];
  assert.equal(savedAmount(adds, 'g1'), 180000);
  assert.equal(monthNet(adds, 'g1', '2026-11'), 180000);
  const s = goalSummary(goal({ monthlyPlan: 200000 }), adds, '2026-11-25');
  assert.deepEqual([s.saved, s.pct, s.month.added, s.month.plan, s.month.pct], [180000, 18, 180000, 200000, 90]);
  // A month that is net negative.
  assert.equal(monthNet([add('g1', '2026-12-01', -5000)], 'g1', '2026-12'), -5000);
});

test('this month’s adds only count that calendar month, across 28/30/31-day months', () => {
  const adds = [add('g1', '2026-02-28', 100), add('g1', '2026-03-01', 200), add('g1', '2026-03-31', 400), add('g1', '2026-04-01', 800)];
  assert.equal(monthNet(adds, 'g1', '2026-02'), 100);
  assert.equal(monthNet(adds, 'g1', '2026-03'), 600);
  assert.equal(monthNet(adds, 'g1', '2026-04'), 800);
});

test('monthly amount needed: only when both a target and a target date are set', () => {
  assert.equal(neededPerMonth(goal({ targetDate: null }), 0, '2026-11-25'), null);
  assert.equal(neededPerMonth(goal({ target: 0, targetDate: '2027-12-31' }), 0, '2026-11-25'), null);
});

test('monthly amount needed counts this month and the target month, rounded up to the paise', () => {
  // 8,00,000 paise left over Nov 2026 .. Dec 2027 = 14 months → 57142.857… → 57143
  const r = neededPerMonth(goal({ target: 1000000, targetDate: '2027-12-31' }), 200000, '2026-11-25');
  assert.deepEqual(r, { state: 'ok', perMonth: 57143, monthsLeft: 14 });
  assert.ok(r.perMonth * r.monthsLeft >= 800000); // never falls short
  // Target in the current month: the whole remainder, this month.
  assert.deepEqual(neededPerMonth(goal({ targetDate: '2026-11-30' }), 400000, '2026-11-25'), { state: 'ok', perMonth: 600000, monthsLeft: 1 });
  // Next month (a 28-day February target): two months.
  assert.equal(neededPerMonth(goal({ targetDate: '2027-02-28' }), 0, '2027-01-31').monthsLeft, 2);
  // Across a year boundary.
  assert.equal(neededPerMonth(goal({ targetDate: '2027-01-10' }), 0, '2026-12-20').monthsLeft, 2);
});

test('monthly amount needed: done once saved reaches the target, past once the date has gone', () => {
  assert.deepEqual(neededPerMonth(goal({ targetDate: '2027-12-31' }), 1000000, '2026-11-25'), { state: 'done', perMonth: 0, monthsLeft: 0 });
  const past = neededPerMonth(goal({ targetDate: '2026-10-31' }), 0, '2026-11-25');
  assert.deepEqual([past.state, past.perMonth, past.daysLate], ['past', null, 25]);
  // A target date of today is still reachable (this month).
  assert.equal(neededPerMonth(goal({ targetDate: '2026-11-25' }), 0, '2026-11-25').state, 'ok');
});

test('split by bucket: buckets, an Unassigned row when needed, and shares', () => {
  const g = goal({ buckets: [{ id: 'b1', name: 'Savings account' }, { id: 'b2', name: 'FD' }, { id: 'b3', name: 'Liquid fund' }] });
  const adds = [add('g1', '2026-11-01', 300000, 'b1'), add('g1', '2026-11-02', 500000, 'b2'), add('g1', '2026-11-03', 200000, 'b2'), add('g1', '2026-11-04', 100000)];
  const split = bucketSplit(g, adds);
  assert.deepEqual(split.map((r) => [r.name, r.amount]), [['Savings account', 300000], ['FD', 700000], ['Liquid fund', 0], ['Unassigned', 100000]]);
  assert.deepEqual(split.map((r) => r.share), [27, 64, 0, 9]);
  // Where there are no buckets there is no split to show, with or without money in the goal.
  assert.deepEqual(goalSummary(goal(), [], '2026-11-25').buckets, []);
  assert.deepEqual(goalSummary(goal(), [add('g1', '2026-11-01', 5)], '2026-11-25').buckets, []);
  assert.equal(goalSummary(g, adds, '2026-11-25').buckets.length, 4);
});

test('withdrawals are limited to what the bucket holds', () => {
  const adds = [add('g1', '2026-11-01', 300000, 'b1'), add('g1', '2026-11-02', 100000, 'b2'), add('g1', '2026-11-03', 50000), add('g1', '2026-11-04', -20000, 'b1')];
  assert.equal(maxWithdrawal(adds, 'g1', 'b1'), 280000);
  assert.equal(maxWithdrawal(adds, 'g1', 'b2'), 100000);
  assert.equal(maxWithdrawal(adds, 'g1', null), 50000);
  assert.equal(maxWithdrawal(adds, 'g1', 'b1', adds[3].id), 300000); // editing that withdrawal
  assert.equal(maxWithdrawal([], 'g1', null), 0);
});

test('saved this month across goals, including withdrawals', () => {
  const adds = [add('g1', '2026-11-02', 100000), add('g2', '2026-11-05', 50000), add('g2', '2026-11-20', -30000), add('g1', '2026-10-31', 999)];
  assert.equal(savedInMonth(adds, '2026-11'), 120000);
  assert.equal(savedInMonth(adds, '2026-10'), 999);
  assert.equal(savedInMonth([], '2026-11'), 0);
});

test('goal adds are never part of spending: totals, budgets, month-to-date and trends use expenses only', () => {
  const expenses = [{ id: 'e1', amount: 40000, categoryId: 'food', date: '2026-11-03', createdAt: 1 }, { id: 'e2', amount: 25000, categoryId: 'food', date: '2026-10-03', createdAt: 2 }];
  const goalAdds = [add('g1', '2026-11-03', 900000), add('g1', '2026-10-03', 800000), add('g1', '2026-11-04', -100000)];
  // The spending maths take only the expense list; whatever goals hold changes nothing.
  assert.equal(monthSpend(expenses, '2026-11').total, 40000);
  assert.deepEqual(monthToDate(expenses, '2026-11-24').total, { cur: 40000, prev: 25000, diff: 15000, pct: 60 });
  assert.deepEqual(trend(expenses, '2026-11', 2).total, [25000, 40000]);
  assert.equal(progress({ food: 100000 }, monthSpend(expenses, '2026-11').byCat).total.spent, 40000);
  assert.equal(savedInMonth(goalAdds, '2026-11'), 800000); // and the reverse: spending isn't in "saved"
  // Structural guard: the spending modules don't even import the goals code or mention goal adds.
  for (const f of ['js/insights.js', 'js/budget.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /goalAdds|goals\.js/, `${f} must not touch goal data`);
  }
});
