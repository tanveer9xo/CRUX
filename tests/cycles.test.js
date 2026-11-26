import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nthLastWorkingDay, weekday, isWorkingDay, nextRuleStart, ruleStartOnOrBefore, cycleName, buildCycles, ensureCycles, validateCycles,
  confirmStart, editStart, cycleOf, movedEntries, dayOfCycle, previousWindow, daysLeftInCycle, cycleRange, DEFAULT_PERIOD_SETTINGS,
} from '../js/cycles.js';
import { addMonths, lastDay, addDays } from '../js/dates.js';

const S = DEFAULT_PERIOD_SETTINGS;
const rec = (...starts) => starts.map((s) => (typeof s === 'string' ? { start: s, source: 'rule' } : s));

// ---------- the rule ----------
test('weekday is by calendar date', () => {
  assert.equal(weekday('2026-11-26'), 4); // Thursday
  assert.equal(weekday('2026-11-28'), 6);
  assert.equal(weekday('2026-11-29'), 0);
  assert.ok(isWorkingDay('2026-11-27') && !isWorkingDay('2026-11-28') && !isWorkingDay('2026-11-27', ['2026-11-27']));
});

test('second-last working day: known months, including those ending on a weekend', () => {
  const known = {
    '2026-10': '2026-10-29', // Oct 31 Sat → Fri 30 last, Thu 29
    '2026-11': '2026-11-27', // Nov 30 Mon last → Fri 27
    '2026-05': '2026-05-28', // May 31 Sun, 30 Sat → Fri 29 last, Thu 28
    '2026-01': '2026-01-29', // Jan 31 Sat → Fri 30, Thu 29
    '2026-08': '2026-08-28', // Aug 31 Mon → Fri 28
    '2026-12': '2026-12-30', // Dec 31 Thu → Wed 30
    '2027-01': '2027-01-28', // Jan 31 Sun, 30 Sat → Fri 29, Thu 28
    '2026-03': '2026-03-30', // 1 Mar is a Sunday; Mar 31 Tue → Mon 30
    '2026-02': '2026-02-26', // non-leap: Feb 28 Sat → Fri 27, Thu 26
    '2027-02': '2027-02-25', // non-leap: Feb 28 Sun → Fri 26, Thu 25
    '2028-02': '2028-02-28', // leap: Feb 29 Tue → Mon 28
    '2024-02': '2024-02-28', // leap: Feb 29 Thu → Wed 28
    '2025-06': '2025-06-27', // 1 Jun is a Sunday; Jun 30 Mon → Fri 27
  };
  for (const [m, d] of Object.entries(known)) assert.equal(nthLastWorkingDay(m, 2), d, m);
});

test('second-last working day for every month 2024–2032: a weekday in that month with exactly one working day after it', () => {
  for (let m = '2024-01'; m <= '2032-12'; m = addMonths(m, 1)) {
    const d = nthLastWorkingDay(m, 2);
    assert.equal(d.slice(0, 7), m, m);
    assert.ok(isWorkingDay(d), `${m}: ${d} is not a working day`);
    let after = 0;
    for (let x = addDays(d, 1); x <= lastDay(m); x = addDays(x, 1)) if (isWorkingDay(x)) after++;
    assert.equal(after, 1, `${m}: ${d} has ${after} working days after it`);
  }
});

test('Nth-last is configurable, and holidays are skipped', () => {
  assert.equal(nthLastWorkingDay('2026-11', 1), '2026-11-30');
  assert.equal(nthLastWorkingDay('2026-11', 3), '2026-11-26');
  assert.equal(nthLastWorkingDay('2026-11', 2, ['2026-11-27']), '2026-11-26'); // the 27th is a holiday
  assert.equal(nthLastWorkingDay('2026-11', 2, ['2026-11-30']), '2026-11-26'); // the last day is a holiday: shift both
  assert.equal(nthLastWorkingDay('2026-12', 2, ['2026-12-31']), '2026-12-29');
});

test('the December → January year boundary', () => {
  assert.equal(nextRuleStart('2026-12-30', S), '2027-01-28');
  const c = buildCycles(rec('2026-12-30', '2027-01-28'), S);
  assert.deepEqual([c[0].key, c[0].end, c[0].days], ['2027-01', '2027-01-27', 29]);
  assert.equal(c[1].key, '2027-02');
  assert.equal(ruleStartOnOrBefore('2027-01-10', S), '2026-12-30');
});

// ---------- naming ----------
test('cycles are named by the month holding most of their days, for lengths 28–35', () => {
  const name = (a, b) => cycleName(a, b);
  assert.equal(name('2027-02-01', '2027-02-28'), '2027-02'); // 28 days
  assert.equal(name('2026-10-29', '2026-11-26'), '2026-11'); // 29 days: your example → November
  assert.equal(name('2026-09-29', '2026-10-28'), '2026-10'); // 30 days
  assert.equal(name('2026-12-30', '2027-01-29'), '2027-01'); // 31 days across the year
  assert.equal(name('2026-10-29', '2026-12-01'), '2026-11'); // 34 days over three months
  assert.equal(name('2026-01-29', '2026-03-04'), '2026-02'); // 35 days: 3 + 28 + 4
  assert.equal(name('2026-11-27', '2026-12-29'), '2026-12'); // "the cycle starting 27 Nov is December"
});

test('a tie goes to the later month', () => {
  assert.equal(cycleName('2026-11-16', '2026-12-15'), '2026-12'); // 15 + 15
  assert.equal(cycleName('2027-01-18', '2027-02-14'), '2027-02'); // 14 + 14 (28 days)
  assert.equal(cycleName('2026-12-17', '2027-01-15'), '2027-01'); // 15 + 15 across the year
});

test('range labels show the dates under the name', () => {
  assert.equal(cycleRange({ start: '2026-10-29', end: '2026-11-26' }), '29 Oct – 26 Nov');
  assert.equal(cycleRange({ start: '2027-02-01', end: '2027-02-28' }), '1–28 Feb');
});

// ---------- records ----------
test('cycles are created from the earliest data date by the rule, and extended to today', () => {
  const { records, added } = ensureCycles([], S, '2026-11-26', '2026-06-03');
  assert.equal(records[0].start, '2026-05-28'); // the cycle that contains 3 June
  assert.equal(records.at(-1).start, '2026-10-29'); // today (26 Nov) is still in the November cycle
  assert.equal(added.length, records.length);
  assert.ok(records.every((r) => r.source === 'rule'));
  const later = ensureCycles(records, S, '2026-11-27');
  assert.deepEqual(later.added, [{ start: '2026-11-27', source: 'rule' }]); // salary day: the December cycle begins
  const earlier = ensureCycles(records, S, '2026-11-26', '2026-04-10');
  assert.deepEqual(earlier.added.map((r) => r.start), ['2026-04-29', '2026-03-30']); // the May and April cycles
  assert.equal(earlier.records.length, records.length + 2);
  assert.equal(buildCycles(earlier.records, S)[0].key, '2026-04'); // 30 Mar – 28 Apr holds 10 April
});

test('past cycles never change when the rule or holidays change; only the expected end moves', () => {
  const r = ensureCycles([], S, '2026-11-26', '2026-08-01').records;
  const before = buildCycles(r, S);
  const after = buildCycles(r, { ...S, nthLast: 1, holidays: ['2026-11-27'] });
  assert.deepEqual(after.slice(0, -1), before.slice(0, -1));
  assert.equal(before.at(-1).end, '2026-11-26');
  assert.equal(after.at(-1).end, '2026-11-29'); // the next start would now be Mon 30 Nov
  assert.ok(after.at(-1).endExpected);
});

test('a late salary replaces the expected start; an early one starts the next cycle', () => {
  // Late: the rule expected Fri 27 Nov, the salary came on Wed 2 Dec.
  const late = confirmStart(rec('2026-10-29', '2026-11-27'), '2026-12-02', S);
  assert.equal(late.error, null);
  assert.deepEqual(late.records, [{ start: '2026-10-29', source: 'rule' }, { start: '2026-12-02', source: 'confirmed' }]);
  const lc = buildCycles(late.records, S);
  assert.deepEqual([lc[0].key, lc[0].end, lc[0].days], ['2026-11', '2026-12-01', 34]);
  assert.deepEqual([lc[1].key, lc[1].start, lc[1].end], ['2026-12', '2026-12-02', '2026-12-29']); // the next (January) salary is still expected 30 Dec
  // Early: the salary came on Fri 20 Nov, a week before the 27th.
  const early = confirmStart(rec('2026-10-29'), '2026-11-20', S);
  assert.equal(early.error, null);
  const ec = buildCycles(early.records, S);
  assert.deepEqual(ec.map((c) => [c.key, c.start, c.end]), [['2026-11', '2026-10-29', '2026-11-19'], ['2026-12', '2026-11-20', '2026-12-29']]);
  // Confirming the expected day itself just marks it confirmed.
  assert.deepEqual(confirmStart(rec('2026-10-29', '2026-11-27'), '2026-11-27', S).records.at(-1), { start: '2026-11-27', source: 'confirmed' });
});

test('overlapping, zero-length and same-named cycles are rejected', () => {
  const r = rec('2026-10-29', { start: '2026-11-27', source: 'confirmed' });
  assert.match(confirmStart(r, '2026-11-27', S).error, /already starts on that day/);
  assert.match(confirmStart(r, '2026-11-10', S).error, /before the current cycle’s start/);
  assert.match(confirmStart(r, '2026-12-01', S).error, /two cycles named after the same month/); // 27–30 Nov would be a second "November"
  assert.match(editStart(r, '2026-11-27', '2026-10-29', S).error, /overlap the cycle before/);
  assert.match(editStart(rec('2026-09-29', '2026-10-29', '2026-11-27'), '2026-10-29', '2026-11-27', S).error, /overlap the cycle after/);
  assert.match(validateCycles(rec('2026-10-29', '2026-10-29'), S), /same day/);
  assert.equal(validateCycles(rec('2026-09-29', '2026-10-29', '2026-11-27'), S), null);
});

test('editing a cycle start re-buckets entries, with a preview of what moves', () => {
  const before = rec('2026-09-29', '2026-10-29', '2026-11-27');
  const { records, error } = editStart(before, '2026-10-29', '2026-10-26', S); // salary came early in October
  assert.equal(error, null);
  assert.deepEqual(records[1], { start: '2026-10-26', source: 'confirmed' });
  const entries = [{ id: 'a', date: '2026-10-25' }, { id: 'b', date: '2026-10-26' }, { id: 'c', date: '2026-10-28' }, { id: 'd', date: '2026-10-29' }];
  const moved = movedEntries(entries, buildCycles(before, S), buildCycles(records, S));
  assert.deepEqual(moved.map((m) => [m.entry.id, m.from, m.to]), [['b', '2026-10', '2026-11'], ['c', '2026-10', '2026-11']]);
});

test('finding the cycle for a date', () => {
  const c = buildCycles(rec('2026-09-29', '2026-10-29'), S);
  assert.equal(cycleOf(c, '2026-10-28').key, '2026-10');
  assert.equal(cycleOf(c, '2026-10-29').key, '2026-11');
  assert.equal(cycleOf(c, '2026-11-26').key, '2026-11');
  assert.equal(cycleOf(c, '2026-11-27'), null); // beyond the last stored cycle
  assert.equal(cycleOf(c, '2026-09-01'), null);
});

// ---------- comparisons ----------
test('day-of-cycle comparison lines up cycles of different lengths', () => {
  const prev = { start: '2026-01-29', end: '2026-03-04' }; // 35 days
  const cur = { start: '2026-03-05', end: '2026-04-01' }; // 28 days
  assert.equal(dayOfCycle(cur, '2026-03-05'), 1);
  assert.equal(dayOfCycle(cur, '2026-04-01'), 28);
  // The last day of a short cycle compares with the first 28 days of the longer previous one, not all 35.
  assert.deepEqual(previousWindow(prev, 28), { from: '2026-01-29', to: '2026-02-25' });
  // Day 35 of a long cycle against a 28-day previous cycle: all of it.
  assert.deepEqual(previousWindow(cur, 35), { from: '2026-03-05', to: '2026-04-01' });
  assert.deepEqual(previousWindow(prev, 1), { from: '2026-01-29', to: '2026-01-29' });
});

test('days left in a cycle count today; the last day gives 1', () => {
  const c = { start: '2026-10-29', end: '2026-11-26' };
  assert.equal(daysLeftInCycle(c, '2026-11-26'), 1);
  assert.equal(daysLeftInCycle(c, '2026-11-20'), 7);
  assert.equal(daysLeftInCycle(c, '2026-10-29'), 29);
});

test('an early salary before an expected (not yet confirmed) start moves that start earlier', () => {
  const r = confirmStart(rec('2026-09-29', '2026-10-29'), '2026-10-26', S);
  assert.equal(r.error, null);
  assert.deepEqual(r.records.at(-1), { start: '2026-10-26', source: 'confirmed' });
  assert.deepEqual(buildCycles(r.records, S).map((c) => [c.key, c.start, c.end]), [['2026-10', '2026-09-29', '2026-10-25'], ['2026-11', '2026-10-26', '2026-11-26']]);
  // …but once confirmed, an earlier date is refused.
  assert.match(confirmStart(r.records, '2026-10-20', S).error, /before the current cycle’s start/);
});
