import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetsFor, rollover, setBudget, totalBudget, recordMonthFor } from '../js/budget.js';

const START = { '2026-09': { food: 800000, rent: 2000000 } };

test('a month without a record uses the latest earlier one; before the first there is no plan', () => {
  assert.deepEqual(budgetsFor(START, '2026-09'), { food: 800000, rent: 2000000 });
  assert.deepEqual(budgetsFor(START, '2027-03'), { food: 800000, rent: 2000000 });
  assert.deepEqual(budgetsFor(START, '2026-08'), {});
  assert.equal(recordMonthFor(START, '2026-08'), null);
});

test('budgetsFor returns a copy, so callers cannot change stored months', () => {
  const plan = budgetsFor(START, '2026-09');
  plan.food = 1;
  assert.equal(START['2026-09'].food, 800000);
});

test('rollover copies the plan forward into the new month', () => {
  const { budgets, created } = rollover(START, '2026-10');
  assert.ok(created);
  assert.deepEqual(budgets['2026-10'], START['2026-09']);
  assert.notEqual(budgets['2026-10'], budgets['2026-09']); // a copy, not the same object
  assert.equal(rollover(budgets, '2026-10').created, false); // idempotent
  assert.equal(rollover({}, '2026-10').created, false); // nothing to copy
});

test('rollover across a gap of several months and a year boundary', () => {
  const { budgets } = rollover(START, '2027-02');
  assert.deepEqual(budgets['2027-02'], START['2026-09']);
  assert.deepEqual(budgetsFor(budgets, '2026-12'), START['2026-09']);
});

test('a budget change applies from the chosen month onward and never changes past months', () => {
  let b = rollover(START, '2026-10').budgets;
  b = rollover(b, '2026-11').budgets;
  const after = setBudget(b, '2026-10', 'food', 900000);
  assert.equal(after['2026-09'].food, 800000); // past month untouched
  assert.equal(after['2026-10'].food, 900000);
  assert.equal(after['2026-11'].food, 900000); // later recorded month follows
  assert.equal(budgetsFor(after, '2027-06').food, 900000); // and the future
  assert.equal(b['2026-10'].food, 800000); // input not mutated
});

test('a change in a month without a record materialises it so earlier months keep their plan', () => {
  // Records for Sep only; change from Dec: Oct and Nov must keep Sep's numbers.
  const after = setBudget(START, '2026-12', 'food', 500000);
  assert.equal(budgetsFor(after, '2026-10').food, 800000);
  assert.equal(budgetsFor(after, '2026-11').food, 800000);
  assert.equal(budgetsFor(after, '2026-12').food, 500000);
  assert.equal(budgetsFor(after, '2027-01').food, 500000);
});

test('a change between two recorded months fills the gap correctly', () => {
  const b = { '2026-08': { food: 100 }, '2026-12': { food: 100 } };
  const after = setBudget(b, '2026-10', 'food', 300);
  assert.equal(budgetsFor(after, '2026-09').food, 100);
  assert.equal(budgetsFor(after, '2026-10').food, 300);
  assert.equal(budgetsFor(after, '2026-11').food, 300);
  assert.equal(budgetsFor(after, '2026-12').food, 300);
});

test('adding and archiving a category from a month onward', () => {
  let b = rollover(START, '2026-10').budgets;
  b = setBudget(b, '2026-10', 'fun', 300000);
  assert.ok(!('fun' in budgetsFor(b, '2026-09')));
  assert.equal(budgetsFor(b, '2026-10').fun, 300000);
  b = setBudget(b, '2026-11', 'rent', null);
  assert.ok('rent' in budgetsFor(b, '2026-10'));
  assert.ok(!('rent' in budgetsFor(b, '2026-11')));
  assert.ok(!('rent' in budgetsFor(b, '2027-05')));
});

test('totals are integer paise', () => {
  assert.equal(totalBudget({ a: 12550, b: 1, c: 99 }), 12650);
  assert.equal(totalBudget({}), 0);
});
