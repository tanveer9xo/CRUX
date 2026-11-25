import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  receivedIn, pendingSources, incomeForMonth, advanceSource, sourceStatus, needingConfirmation, receiveIncome, skipSource, monthPlan,
  plannedGoalTotal, leftoverFor, plannedRemaining, prefillAllocation, checkAllocation, savingsRate, ratePoints, incomeTrend, savingsMtd, goalNetIn,
} from '../js/income.js';
import { resolveSchedule } from '../js/bills.js';
import { parseAmount } from '../js/money.js';
import { monthSpend, monthToDate, trend, progress } from '../js/insights.js';

let n = 0;
const inc = (date, amount, over = {}) => ({ id: `i${n++}`, sourceId: null, source: 'Other', amount, date, note: '', createdAt: n, ...over });
const exp = (date, amount, categoryId = 'food') => ({ id: `e${n++}`, date, amount, categoryId, createdAt: n });
const add = (goalId, date, amount) => ({ id: `a${n++}`, goalId, date, amount, bucketId: null, note: '', createdAt: n });
const goal = (id, order, over = {}) => ({ id, name: id, target: 0, monthlyPlan: 0, buckets: [], archived: false, order, ...over });
const source = (over = {}) => ({ id: 's1', name: 'Salary', amount: 5000000, nextDate: '2026-11-30', anchorDay: 30, lastDay: false, note: '', archived: false, ...over });

// ---------- recurring dates ----------
test('a salary on the 31st walks Jan 31 → Feb 28 → Mar 31 → Apr 30 (month lengths 28/30/31)', () => {
  let s = source({ nextDate: '2026-01-31', anchorDay: 31 });
  const seen = [];
  for (let i = 0; i < 4; i++) { s = { ...s, nextDate: advanceSource(s) }; seen.push(s.nextDate); }
  assert.deepEqual(seen, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('salary days 29 and 30 in February, leap and common years', () => {
  assert.equal(advanceSource(source({ nextDate: '2026-01-29', anchorDay: 29 })), '2026-02-28');
  assert.equal(advanceSource(source({ nextDate: '2028-01-29', anchorDay: 29 })), '2028-02-29');
  assert.equal(advanceSource(source({ nextDate: '2026-01-30', anchorDay: 30 })), '2026-02-28');
  assert.equal(advanceSource(source({ nextDate: '2028-01-30', anchorDay: 30 })), '2028-02-29');
  assert.equal(advanceSource(source({ nextDate: '2026-02-28', anchorDay: 30 })), '2026-03-30'); // snaps back
  assert.equal(advanceSource(source({ nextDate: '2026-02-28', anchorDay: 28 })), '2026-03-28');
});

test('a salary crosses the year boundary', () => {
  assert.equal(advanceSource(source({ nextDate: '2026-12-31', anchorDay: 31 })), '2027-01-31');
  assert.equal(advanceSource(source({ nextDate: '2026-12-01', anchorDay: 1 })), '2027-01-01');
  assert.equal(advanceSource(source({ nextDate: '2026-12-28', anchorDay: 28 })), '2027-01-28');
});

test('“last day of the month” works for income the same way as for bills', () => {
  const sched = resolveSchedule({ dueDate: '2026-11-10', lastDay: true });
  let s = source({ ...sched, nextDate: sched.dueDate });
  assert.deepEqual([s.nextDate, s.anchorDay, s.lastDay], ['2026-11-30', 31, true]);
  const seen = [];
  for (let i = 0; i < 4; i++) { s = { ...s, nextDate: advanceSource(s) }; seen.push(s.nextDate); }
  assert.deepEqual(seen, ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
});

test('confirming a salary logs the entry and moves it on; skipping moves it on without an entry', () => {
  const s = source({ nextDate: '2026-11-30', anchorDay: 31 });
  const r = receiveIncome(s, { today: '2026-12-01' });
  assert.deepEqual(r.entry, { sourceId: 's1', source: 'Salary', amount: 5000000, date: '2026-12-01', note: '' });
  assert.equal(r.source.nextDate, '2026-12-31');
  assert.equal(s.nextDate, '2026-11-30'); // the original is untouched (Undo restores it)
  assert.equal(receiveIncome(s, { today: '2026-12-01', amount: 4900000 }).entry.amount, 4900000); // a different amount this time
  assert.equal(skipSource(s).nextDate, '2026-12-31');
});

test('a recurring income shows for confirmation inside its window, and when late', () => {
  const s = source({ nextDate: '2026-11-30' });
  assert.deepEqual(sourceStatus(s, '2026-11-25'), { days: 5, state: 'soon' });
  assert.equal(sourceStatus(s, '2026-11-24').state, 'later');
  assert.equal(sourceStatus(s, '2026-11-30').state, 'soon');
  assert.equal(sourceStatus(s, '2026-12-02').state, 'late');
  const list = [source({ id: 'a', name: 'B', nextDate: '2026-12-01' }), source({ id: 'b', name: 'A', nextDate: '2026-11-28' }), source({ id: 'c', nextDate: '2027-02-01' }), source({ id: 'd', nextDate: '2026-11-28', archived: true })];
  assert.deepEqual(needingConfirmation(list, '2026-11-27').map((x) => x.id), ['b', 'a']);
});

// ---------- received and expected ----------
test('received income counts only that month, to the paise', () => {
  const income = [inc('2026-10-31', 1000), inc('2026-11-01', 2000), inc('2026-11-30', 3000), inc('2026-12-01', 4000)];
  assert.equal(receivedIn(income, '2026-11'), 5000);
  assert.equal(receivedIn(income, '2026-10'), 1000);
  assert.equal(receivedIn([], '2026-11'), 0);
});

test('expected = received so far + recurring income still to come this month', () => {
  const sources = [source({ id: 'sal', amount: 5000000, nextDate: '2026-11-30' }), source({ id: 'rent', amount: 800000, nextDate: '2026-12-05' }), source({ id: 'blank', amount: null, nextDate: '2026-11-15' })];
  const income = [inc('2026-11-03', 120000)];
  // November (current): salary still due this month; rent is next month's; the blank-amount source adds nothing.
  assert.deepEqual(incomeForMonth(income, sources, '2026-11', '2026-11-20'), { received: 120000, pending: 5000000, expected: 5120000 });
  // Once the salary is confirmed its next date moves to December and it is no longer "pending" for November.
  const paid = [{ ...sources[0], nextDate: '2026-12-31' }, sources[1]];
  assert.equal(incomeForMonth([...income, inc('2026-11-28', 5000000)], paid, '2026-11', '2026-11-28').pending, 0);
  // A late salary (expected in an earlier month, unconfirmed) still counts as pending now.
  assert.equal(pendingSources([source({ nextDate: '2026-10-31' })], '2026-11', '2026-11-20').length, 1);
  // A future month expects every active recurring source; a past month only what arrived.
  assert.equal(incomeForMonth([], sources, '2027-01', '2026-11-20').expected, 5800000);
  assert.deepEqual(incomeForMonth([inc('2026-09-30', 700)], sources, '2026-09', '2026-11-20'), { received: 700, pending: 0, expected: 700 });
  assert.equal(pendingSources([source({ archived: true })], '2026-11', '2026-11-20').length, 0);
});

// ---------- month plan ----------
test('unassigned = income − budgets − planned goal contributions', () => {
  const p = monthPlan({ expected: 10000000, received: 4000000, budgetTotal: 6000000, goalPlanTotal: 1500000 });
  assert.deepEqual([p.unassigned, p.over, p.overBy, p.received], [2500000, false, 0, 4000000]);
});

test('over-planned: negative unassigned flags the warning with the amount', () => {
  const p = monthPlan({ expected: 5000000, received: 0, budgetTotal: 4200000, goalPlanTotal: 1300000 });
  assert.deepEqual([p.unassigned, p.over, p.overBy], [-500000, true, 500000]);
  assert.equal(monthPlan({ expected: 100, received: 0, budgetTotal: 100, goalPlanTotal: 0 }).over, false); // exactly planned is fine
  assert.equal(monthPlan({ expected: 0, received: 0, budgetTotal: 1, goalPlanTotal: 0 }).overBy, 1); // no income yet
});

test('planned goal contributions count active goals with a plan only', () => {
  assert.equal(plannedGoalTotal([goal('a', 0, { monthlyPlan: 100000 }), goal('b', 1, { monthlyPlan: 0 }), goal('c', 2, { monthlyPlan: 50050 }), goal('d', 3, { monthlyPlan: 999, archived: true })]), 150050);
});

// ---------- leftover ----------
test('leftover = income received − expenses logged − goal adds made this month', () => {
  const r = leftoverFor({
    income: [inc('2026-11-01', 6000000), inc('2026-10-31', 999999)],
    entries: [exp('2026-11-05', 1500000), exp('2026-11-20', 250050), exp('2026-10-31', 777)],
    goalAdds: [add('g1', '2026-11-10', 800000), add('g1', '2026-11-12', -100000), add('g1', '2026-10-30', 5)],
    month: '2026-11',
  });
  assert.deepEqual(r, { received: 6000000, spent: 1750050, saved: 700000, leftover: 3549950 });
});

test('leftover can be negative: spent and saved more than has been received', () => {
  const r = leftoverFor({ income: [inc('2026-11-01', 100000)], entries: [exp('2026-11-02', 90000)], goalAdds: [add('g', '2026-11-03', 30000)], month: '2026-11' });
  assert.equal(r.leftover, -20000);
  assert.equal(leftoverFor({ income: [], entries: [exp('2026-11-02', 500)], goalAdds: [], month: '2026-11' }).leftover, -500); // no income at all
  assert.equal(leftoverFor({ income: [], entries: [], goalAdds: [], month: '2026-11' }).leftover, 0);
});

test('a withdrawal from a goal returns money to the leftover', () => {
  const base = { income: [inc('2026-11-01', 100000)], entries: [], month: '2026-11' };
  assert.equal(leftoverFor({ ...base, goalAdds: [add('g', '2026-11-02', 40000)] }).leftover, 60000);
  assert.equal(leftoverFor({ ...base, goalAdds: [add('g', '2026-11-02', 40000), add('g', '2026-11-03', -10000)] }).leftover, 70000);
});

// ---------- allocation ----------
test('prefill: each goal’s remaining plan for the month, in priority order, until the leftover runs out', () => {
  const goals = [goal('low', 2, { monthlyPlan: 300000 }), goal('top', 0, { monthlyPlan: 500000 }), goal('mid', 1, { monthlyPlan: 400000 })];
  const adds = [add('mid', '2026-11-02', 150000), add('top', '2026-10-31', 999999)]; // only November counts
  assert.deepEqual(prefillAllocation(goals, adds, '2026-11', 1000000).map((r) => [r.goalId, r.amount]), [['top', 500000], ['mid', 250000], ['low', 250000]]);
  // Plenty of leftover: everyone gets their full remaining plan.
  assert.deepEqual(prefillAllocation(goals, adds, '2026-11', 9999999).map((r) => r.amount), [500000, 250000, 300000]);
  // The higher-priority goal is filled first even when it exhausts the leftover.
  assert.deepEqual(prefillAllocation(goals, adds, '2026-11', 300000).map((r) => [r.goalId, r.amount]), [['top', 300000], ['mid', 0], ['low', 0]]);
});

test('prefill is zero when the leftover is zero or negative, and for goals with no plan or already met', () => {
  const goals = [goal('a', 0, { monthlyPlan: 100000 }), goal('b', 1, { monthlyPlan: 0 }), goal('c', 2, { monthlyPlan: 50000 }), goal('d', 3, { monthlyPlan: 10, archived: true })];
  assert.ok(prefillAllocation(goals, [], '2026-11', 0).every((r) => r.amount === 0));
  assert.ok(prefillAllocation(goals, [], '2026-11', -50000).every((r) => r.amount === 0));
  assert.equal(prefillAllocation(goals, [], '2026-11', 1e9).length, 3); // archived goals are not listed
  assert.equal(plannedRemaining(goal('c', 0, { monthlyPlan: 50000 }), [add('c', '2026-11-01', 80000)], '2026-11'), 0); // plan already exceeded
  assert.equal(plannedRemaining(goal('b', 0), [], '2026-11'), 0);
});

test('prefill never exceeds the leftover and sums in whole paise', () => {
  const goals = [goal('a', 0, { monthlyPlan: 33333 }), goal('b', 1, { monthlyPlan: 33333 }), goal('c', 2, { monthlyPlan: 33333 })];
  const r = prefillAllocation(goals, [], '2026-11', 100000);
  assert.deepEqual(r.map((x) => x.amount), [33333, 33333, 33333]);
  const tight = prefillAllocation(goals, [], '2026-11', 70001);
  assert.deepEqual(tight.map((x) => x.amount), [33333, 33333, 3335]);
  assert.equal(tight.reduce((a, x) => a + x.amount, 0), 70001);
  assert.ok(tight.every((x) => Number.isInteger(x.amount)));
});

test('allocation limits: allowed up to the leftover, blocked above it, with what stays unassigned', () => {
  assert.deepEqual(checkAllocation([300000, 200000], 800000), { total: 500000, ok: true, over: 0, unassigned: 300000 });
  assert.deepEqual(checkAllocation([500000, 300000], 800000), { total: 800000, ok: true, over: 0, unassigned: 0 }); // exactly the leftover
  assert.deepEqual(checkAllocation([500000, 300001], 800000), { total: 800001, ok: false, over: 1, unassigned: -1 }); // one paise too many
  assert.deepEqual(checkAllocation([1], 0), { total: 1, ok: false, over: 1, unassigned: -1 });
  assert.deepEqual(checkAllocation([1], -500), { total: 1, ok: false, over: 1, unassigned: -1 }); // a negative leftover has no room
  assert.deepEqual(checkAllocation([], 500), { total: 0, ok: true, over: 0, unassigned: 500 });
});

test('typed amounts round to the paise before they are checked', () => {
  const typed = ['1,000.005', '0.004', '2,500.50'].map(parseAmount);
  assert.deepEqual(typed, [100001, 0, 250050]); // half up at the third decimal, no float error
  assert.deepEqual(checkAllocation(typed, 350051), { total: 350051, ok: true, over: 0, unassigned: 0 });
  assert.equal(checkAllocation(typed, 350050).ok, false);
});

// ---------- savings rate ----------
test('savings rate = goal adds ÷ income received, a whole percent', () => {
  assert.equal(savingsRate(2000000, 10000000), 20);
  assert.equal(savingsRate(1, 3), 33);
  assert.equal(savingsRate(1, 1000), 0); // 0.1 % rounds to 0
  assert.equal(savingsRate(1234, 10000), 12);
  assert.equal(savingsRate(125, 1000), 13); // 12.5 → 13 (half away from zero)
  assert.equal(savingsRate(-125, 1000), -13); // a net withdrawal is a negative rate
  assert.equal(savingsRate(0, 500000), 0);
});

test('savings rate with zero (or no) income is null, never a divide-by-zero', () => {
  assert.equal(savingsRate(50000, 0), null);
  assert.equal(savingsRate(0, 0), null);
  assert.equal(savingsRate(-5, 0), null);
  assert.equal(savingsRate(50000, -1), null);
  assert.equal(ratePoints(null, 20), null);
  assert.equal(ratePoints(20, null), null);
  assert.equal(ratePoints(25, 20), 5);
});

test('6-month trend of income, spending, saving and rate across the year boundary', () => {
  const income = [inc('2026-09-30', 1000000), inc('2026-10-31', 1000000), inc('2026-12-31', 2000000), inc('2027-01-01', 1000000)];
  const entries = [exp('2026-10-05', 300000), exp('2026-12-05', 500000), exp('2027-02-03', 999)];
  const goalAdds = [add('g', '2026-10-06', 200000), add('g', '2026-12-06', 400000), add('g', '2026-12-07', -100000), add('g', '2027-01-04', 50000)];
  const t = incomeTrend({ income, entries, goalAdds, endMonth: '2027-02', n: 6 });
  assert.deepEqual(t.months, ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(t.income, [1000000, 1000000, 0, 2000000, 1000000, 0]);
  assert.deepEqual(t.spent, [0, 300000, 0, 500000, 0, 999]);
  assert.deepEqual(t.saved, [0, 200000, 0, 300000, 50000, 0]);
  assert.deepEqual(t.rate, [0, 20, null, 15, 5, null]); // Nov and Feb had no income: null, not NaN
});

test('savings rate month to date against the same days last month (31 Mar → all of February)', () => {
  const income = [inc('2026-02-10', 1000000), inc('2026-03-05', 2000000), inc('2026-03-31', 8000000)];
  const goalAdds = [add('g', '2026-02-12', 100000), add('g', '2026-03-07', 600000)];
  const r = savingsMtd({ income, entries: [exp('2026-03-02', 40000)], goalAdds, today: '2026-03-31' });
  assert.deepEqual(r.previous.to, '2026-02-28');
  assert.deepEqual([r.previous.income, r.previous.saved, r.previous.rate], [1000000, 100000, 10]);
  assert.deepEqual([r.current.income, r.current.saved, r.current.rate, r.current.spent], [10000000, 600000, 6, 40000]);
  assert.equal(r.points, -4);
  // Earlier in the month only the matching days count.
  const early = savingsMtd({ income, entries: [], goalAdds, today: '2026-03-06' });
  assert.deepEqual([early.current.income, early.current.saved, early.previous.to], [2000000, 0, '2026-02-06']);
  assert.equal(early.previous.income, 0); // 10 Feb is after the 6th: not yet
  assert.equal(early.previous.rate, null);
  assert.equal(early.points, null); // no income last time: no comparison, no crash
});

// ---------- income is not spending ----------
test('income never reaches spending totals, budget bars or the spending comparisons', () => {
  const entries = [exp('2026-11-03', 40000), exp('2026-10-03', 25000)];
  const income = [inc('2026-11-01', 9000000), inc('2026-10-01', 8000000)];
  assert.equal(monthSpend(entries, '2026-11').total, 40000);
  assert.deepEqual(monthToDate(entries, '2026-11-24').total, { cur: 40000, prev: 25000, diff: 15000, pct: 60 });
  assert.deepEqual(trend(entries, '2026-11', 2).total, [25000, 40000]);
  assert.equal(progress({ food: 100000 }, monthSpend(entries, '2026-11').byCat).total.spent, 40000);
  assert.equal(receivedIn(income, '2026-11'), 9000000); // and the reverse: expenses aren't income
  assert.equal(goalNetIn([add('g', '2026-11-03', 700)], '2026-11'), 700); // nor are goal adds
  // Structural guard: the spending modules neither import the income code nor mention income.
  for (const f of ['js/insights.js', 'js/budget.js', 'js/goals.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /income\.js|incomeSources|\bincome\b/i, `${f} must not touch income`);
  }
});
