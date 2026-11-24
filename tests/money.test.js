import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatINR, formatCompact, groupIndian, paiseToInput, pctChange, pctUsed, budgetStatus } from '../js/money.js';

test('parseAmount turns typed rupees into integer paise', () => {
  assert.equal(parseAmount('250'), 25000);
  assert.equal(parseAmount('250.5'), 25050);
  assert.equal(parseAmount('250.50'), 25050);
  assert.equal(parseAmount('.75'), 75);
  assert.equal(parseAmount('0.01'), 1);
  assert.equal(parseAmount('1,25,000'), 12500000);
  assert.equal(parseAmount(' ₹ 99.99 '), 9999);
  assert.equal(parseAmount('Rs. 40'), 4000);
  assert.equal(parseAmount('007'), 700);
  assert.equal(parseAmount('12.'), 1200);
});

test('parseAmount rounds half up at the paise, without float error', () => {
  assert.equal(parseAmount('0.125'), 13);
  assert.equal(parseAmount('0.124'), 12);
  assert.equal(parseAmount('0.1249'), 12);
  assert.equal(parseAmount('1.005'), 101); // 1.005 * 100 is 100.49999… as a float
  assert.equal(parseAmount('1.995'), 200);
  assert.equal(parseAmount('19.999'), 2000);
  assert.equal(parseAmount('0.1 '.trim()), 10); // 0.1 is not exact as a float
  assert.equal(parseAmount('0.29'), 29); // 0.29 * 100 = 28.999999999999996
  assert.equal(parseAmount('4.35'), 435); // 4.35 * 100 = 434.99999999999994
  for (const v of ['0.29', '4.35', '1.15', '8.20', '1234.56']) assert.ok(Number.isInteger(parseAmount(v)));
});

test('parseAmount rejects empty, negative and malformed input', () => {
  for (const v of ['', ' ', '.', '-5', 'abc', '1.2.3', '1e5', '12a', null, undefined, '999999999999999']) {
    assert.equal(parseAmount(v), null, String(v));
  }
});

test('Indian digit grouping', () => {
  assert.equal(groupIndian(0), '0');
  assert.equal(groupIndian(999), '999');
  assert.equal(groupIndian(1000), '1,000');
  assert.equal(groupIndian(99999), '99,999');
  assert.equal(groupIndian(125000), '1,25,000');
  assert.equal(groupIndian(1234567), '12,34,567');
  assert.equal(groupIndian(123456789), '12,34,56,789');
});

test('formatINR shows rupees with Indian grouping and paise only when present', () => {
  assert.equal(formatINR(12500000), '₹1,25,000');
  assert.equal(formatINR(12550), '₹125.50');
  assert.equal(formatINR(5), '₹0.05');
  assert.equal(formatINR(0), '₹0');
  assert.equal(formatINR(-50000), '−₹500');
  assert.equal(formatINR(50000, { sign: true }), '+₹500');
  assert.equal(formatINR(0, { sign: true }), '₹0');
  assert.equal(formatINR(12500000, { decimals: 'always' }), '₹1,25,000.00');
  assert.equal(formatINR(12550, { decimals: 'never' }), '₹126');
  assert.equal(formatINR(12549, { decimals: 'never' }), '₹125');
  assert.equal(formatINR(-12550, { decimals: 'never' }), '−₹126');
});

test('formatCompact for chart labels', () => {
  assert.equal(formatCompact(95000), '₹950');
  assert.equal(formatCompact(1250000), '₹12.5K');
  assert.equal(formatCompact(1500000_00 / 10), '₹1.5L');
  assert.equal(formatCompact(250000), '₹2.5K');
  assert.equal(formatCompact(12000000), '₹1.2L');
  assert.equal(formatCompact(3_40_00_000_00), '₹3.4Cr');
});

test('paiseToInput round-trips through parseAmount', () => {
  for (const p of [0, 1, 99, 100, 12550, 12500000, 123456789]) assert.equal(parseAmount(paiseToInput(p)), p);
  assert.equal(paiseToInput(25000), '250');
  assert.equal(paiseToInput(25005), '250.05');
  assert.equal(paiseToInput(12500000, { group: true }), '1,25,000');
  assert.equal(parseAmount(paiseToInput(12345678, { group: true })), 12345678);
});

test('pctChange: whole percent, symmetric rounding, null when there was nothing before', () => {
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(50, 100), -50);
  assert.equal(pctChange(100, 100), 0);
  assert.equal(pctChange(0, 0), 0);
  assert.equal(pctChange(500, 0), null);
  assert.equal(pctChange(0, 400), -100);
  assert.equal(pctChange(1025, 1000), 3); // 2.5 → 3
  assert.equal(pctChange(975, 1000), -3); // −2.5 → −3, not −2
  assert.equal(pctChange(1, 3), -67);
});

test('budget status: amber from 80 %, red only when over', () => {
  assert.equal(budgetStatus(0, 100000), 'ok');
  assert.equal(budgetStatus(79999, 100000), 'ok');
  assert.equal(budgetStatus(80000, 100000), 'warn');
  assert.equal(budgetStatus(100000, 100000), 'warn'); // exactly on budget is not over
  assert.equal(budgetStatus(100001, 100000), 'over');
  assert.equal(budgetStatus(1, 0), 'over'); // spending against a zero budget
  assert.equal(budgetStatus(0, 0), 'ok');
  // 80 % of an amount that doesn't divide evenly: 4/5 of 333 paise is 266.4
  assert.equal(budgetStatus(266, 333), 'ok');
  assert.equal(budgetStatus(267, 333), 'warn');
});

test('pctUsed rounds down and is null without a budget', () => {
  assert.equal(pctUsed(79999, 100000), 79);
  assert.equal(pctUsed(80000, 100000), 80);
  assert.equal(pctUsed(150000, 100000), 150);
  assert.equal(pctUsed(500, 0), null);
});
