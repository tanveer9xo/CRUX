import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysInMonth, isLeapYear, sameDayLastMonth, addMonths, firstDay, lastDay, daysLeftInMonth, monthsEnding,
  isYmd, isMonth, todayYmd, addDays, dayLabel, monthLabel, rangeLabel,
} from '../js/dates.js';

test('months have 28, 29, 30 or 31 days', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m)), [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2000, 2), 29); // divisible by 400
  assert.equal(daysInMonth(2100, 2), 28); // divisible by 100, not 400
  assert.ok(isLeapYear(2024) && !isLeapYear(2026));
});

test('month arithmetic crosses year boundaries', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2025-12', 1), '2026-01');
  assert.equal(addMonths('2026-11', -13), '2025-10');
  assert.equal(addMonths('2026-11', 14), '2028-01');
  assert.deepEqual(monthsEnding('2026-02', 6), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
});

test('first and last day of 28/29/30/31-day months', () => {
  assert.equal(firstDay('2026-02'), '2026-02-01');
  assert.equal(lastDay('2026-02'), '2026-02-28');
  assert.equal(lastDay('2028-02'), '2028-02-29');
  assert.equal(lastDay('2026-04'), '2026-04-30');
  assert.equal(lastDay('2026-12'), '2026-12-31');
});

test('same day last month clamps to the shorter month', () => {
  assert.equal(sameDayLastMonth('2026-11-24'), '2026-10-24');
  assert.equal(sameDayLastMonth('2026-03-31'), '2026-02-28'); // 31 → 28
  assert.equal(sameDayLastMonth('2028-03-31'), '2028-02-29'); // leap year
  assert.equal(sameDayLastMonth('2026-03-29'), '2026-02-28');
  assert.equal(sameDayLastMonth('2026-05-31'), '2026-04-30'); // 31 → 30
  assert.equal(sameDayLastMonth('2026-07-31'), '2026-06-30');
  assert.equal(sameDayLastMonth('2026-02-28'), '2026-01-28'); // short → long keeps the day
  assert.equal(sameDayLastMonth('2026-04-30'), '2026-03-30');
  assert.equal(sameDayLastMonth('2026-01-31'), '2025-12-31'); // across the year
  assert.equal(sameDayLastMonth('2026-01-01'), '2025-12-01');
});

test('days left in the month count today', () => {
  assert.equal(daysLeftInMonth('2026-11-24'), 7);
  assert.equal(daysLeftInMonth('2026-11-30'), 1);
  assert.equal(daysLeftInMonth('2026-02-01'), 28);
  assert.equal(daysLeftInMonth('2028-02-01'), 29);
  assert.equal(daysLeftInMonth('2026-12-01'), 31);
});

test('date validation rejects impossible dates', () => {
  assert.ok(isYmd('2026-02-28') && isYmd('2028-02-29') && isYmd('2026-12-31'));
  for (const bad of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-1', '26-01-01', '', null]) assert.ok(!isYmd(bad), String(bad));
  assert.ok(isMonth('2026-11') && !isMonth('2026-13') && !isMonth('2026-1'));
});

test('local today and day shifting', () => {
  assert.equal(todayYmd(new Date(2026, 10, 24, 23, 59)), '2026-11-24');
  assert.equal(todayYmd(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('labels do not depend on the time zone', () => {
  assert.equal(dayLabel('2026-11-24'), 'Tue, 24 Nov');
  assert.equal(dayLabel('2026-03-01'), 'Sun, 1 Mar');
  assert.equal(monthLabel('2026-11'), 'November 2026');
  assert.equal(monthLabel('2026-11', { short: true }), 'Nov 2026');
  assert.equal(rangeLabel('2026-11-01', '2026-11-24'), '1–24 Nov');
  assert.equal(rangeLabel('2026-11-01', '2026-11-01'), '1 Nov');
});
