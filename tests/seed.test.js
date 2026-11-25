import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_CATEGORIES, SEED_BUDGET, COLORS, SEED_GOALS } from '../js/seed.js';

const NAMES = ['Rent', 'Bike EMI', 'Buffer/Miscellaneous', 'Groceries', 'CC Payment', 'Dine In/Out', 'Gym', 'Petrol', 'Bhatuk',
  'Insurance', 'Subscriptions', 'Wifi', 'Furniture', 'Electricity', 'Supplements', 'Cosmetics', 'Bike Maintenance', 'Phone Bill'];

test('the 18 seed categories are in the requested order', () => {
  assert.deepEqual(SEED_CATEGORIES.map((c) => c.name), NAMES);
});

test('every seed budget is ₹0, so no real amounts live in the repo', () => {
  assert.equal(SEED_BUDGET, 0);
});

test('each category has its own emoji and its own colour', () => {
  assert.equal(new Set(SEED_CATEGORIES.map((c) => c.emoji)).size, 18);
  assert.equal(new Set(SEED_CATEGORIES.map((c) => c.color.toLowerCase())).size, 18);
  for (const c of SEED_CATEGORIES) assert.match(c.color, /^#[0-9A-Fa-f]{6}$/);
  assert.deepEqual(COLORS, SEED_CATEGORIES.map((c) => c.color));
});

test('names fit the 40-character category limit', () => {
  for (const c of SEED_CATEGORIES) assert.ok(c.name.length <= 40);
});

test('three starter goals, in order, with no targets (₹0): real targets are entered in the app', () => {
  assert.deepEqual(SEED_GOALS.map((g) => g.name), ['Emergency fund', 'Wedding fund', 'Long-term investments']);
  for (const g of SEED_GOALS) assert.ok(!('target' in g) && !('amount' in g), 'no amounts in the seed');
  assert.equal(new Set(SEED_GOALS.map((g) => g.emoji)).size, 3);
});
