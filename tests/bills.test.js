import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceDue, billStatus, endedReason, markPaid, skipOne, sweepEnded, defaultLogExpense, needingAttention, dueText, byDue, resolveSchedule, lastDayOfMonth,
} from '../js/bills.js';

const bill = (over = {}) => ({
  id: 'b1', name: 'Test bill', type: 'bill', amount: 120000, recurrence: 'monthly', dueDate: '2026-11-15', anchorDay: 15, warnDays: 3,
  endDate: null, installmentsLeft: null, note: '', categoryId: 'c1', logExpense: true, lastDay: false, archived: false, archivedReason: null, ...over,
});

test('monthly due dates advance across 28/29/30/31-day months and snap back to the due day', () => {
  // Due on the 31st: Jan 31 → Feb 28 → Mar 31 → Apr 30 → May 31 (never drifts to the 28th).
  let d = '2026-01-31';
  const seen = [];
  for (let i = 0; i < 4; i++) { d = advanceDue(d, 'monthly', 31); seen.push(d); }
  assert.deepEqual(seen, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.equal(advanceDue('2028-01-31', 'monthly', 31), '2028-02-29'); // leap year
  assert.equal(advanceDue('2026-01-29', 'monthly', 29), '2026-02-28'); // 29 → 28
  assert.equal(advanceDue('2028-01-29', 'monthly', 29), '2028-02-29');
  assert.equal(advanceDue('2026-01-30', 'monthly', 30), '2026-02-28');
  assert.equal(advanceDue('2026-03-30', 'monthly', 30), '2026-04-30');
  assert.equal(advanceDue('2026-02-15', 'monthly', 15), '2026-03-15'); // ordinary days stay put
});

test('year rollover', () => {
  assert.equal(advanceDue('2026-12-15', 'monthly', 15), '2027-01-15');
  assert.equal(advanceDue('2026-12-31', 'monthly', 31), '2027-01-31');
  assert.equal(advanceDue('2026-11-30', 'quarterly', 30), '2027-02-28');
  assert.equal(advanceDue('2026-10-31', 'quarterly', 31), '2027-01-31');
  assert.equal(advanceDue('2026-12-25', 'yearly', 25), '2027-12-25');
});

test('quarterly and yearly keep their day, clamped where the month is shorter', () => {
  assert.equal(advanceDue('2026-05-31', 'quarterly', 31), '2026-08-31');
  assert.equal(advanceDue('2026-11-30', 'quarterly', 30), '2027-02-28');
  assert.equal(advanceDue('2027-02-28', 'quarterly', 30), '2027-05-30');
});

test('a yearly item on 29 Feb falls back to 28 Feb in common years and returns on the next leap day', () => {
  let d = '2028-02-29';
  const seen = [];
  for (let i = 0; i < 4; i++) { d = advanceDue(d, 'yearly', 29); seen.push(d); }
  assert.deepEqual(seen, ['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
});

test('a one-time item has no next date', () => {
  assert.equal(advanceDue('2026-11-15', 'once', 15), null);
});

test('state: overdue, due soon (inside the warning window, today included), later', () => {
  const b = bill({ dueDate: '2026-11-25', warnDays: 3 });
  assert.deepEqual(billStatus(b, '2026-11-26'), { days: -1, state: 'overdue' });
  assert.deepEqual(billStatus(b, '2026-11-25'), { days: 0, state: 'soon' });
  assert.equal(billStatus(b, '2026-11-22').state, 'soon'); // exactly 3 days before
  assert.equal(billStatus(b, '2026-11-21').state, 'later'); // 4 days before
  assert.equal(billStatus(bill({ dueDate: '2026-12-02', warnDays: 10 }), '2026-11-25').state, 'soon');
  assert.equal(billStatus(bill({ dueDate: '2027-01-02', warnDays: 0 }), '2026-12-31').state, 'later');
  assert.equal(billStatus(bill({ dueDate: '2026-12-31', warnDays: 0 }), '2026-12-31').state, 'soon'); // 0-day window = the day itself
  assert.equal(billStatus(bill({ dueDate: '2027-01-01' }), '2026-12-31').days, 1); // across the year
});

test('overdue / soon / later labels read naturally', () => {
  assert.equal(dueText(bill({ dueDate: '2026-11-24' }), '2026-11-25'), '1 day overdue · Tue, 24 Nov');
  assert.equal(dueText(bill({ dueDate: '2026-11-20' }), '2026-11-25'), '5 days overdue · Fri, 20 Nov');
  assert.equal(dueText(bill({ dueDate: '2026-11-25' }), '2026-11-25'), 'Due today · Wed, 25 Nov');
  assert.equal(dueText(bill({ dueDate: '2026-11-26' }), '2026-11-25'), 'Due tomorrow · Thu, 26 Nov');
  assert.equal(dueText(bill({ dueDate: '2026-12-05' }), '2026-11-25'), 'Sat, 5 Dec · in 10 days');
});

test('credit card dues default to NOT logging an expense; everything else defaults to logging', () => {
  assert.equal(defaultLogExpense('cc'), false);
  for (const t of ['emi', 'insurance', 'subscription', 'bill', 'other']) assert.equal(defaultLogExpense(t), true, t);
});

test('mark paid with expense logging: next date, and a prefill with the amount and linked category', () => {
  const r = markPaid(bill());
  assert.equal(r.bill.dueDate, '2026-12-15');
  assert.equal(r.bill.archived, false);
  assert.deepEqual(r.expense, { amount: 120000, categoryId: 'c1', note: 'Test bill' });
  assert.equal(r.archivedReason, null);
});

test('mark paid without expense logging (the toggle off, as for card bills): date moves, no expense offered', () => {
  const r = markPaid(bill({ type: 'cc', logExpense: false }));
  assert.equal(r.expense, null);
  assert.equal(r.bill.dueDate, '2026-12-15');
});

test('mark paid prefill has no amount when the bill has none, and no category when unlinked', () => {
  assert.deepEqual(markPaid(bill({ amount: null, categoryId: null })).expense, { amount: null, categoryId: null, note: 'Test bill' });
  assert.equal(markPaid(bill({ amount: 0 })).expense.amount, null);
});

test('mark paid does not change the original bill (so Undo can restore it)', () => {
  const b = bill({ installmentsLeft: 3 });
  const before = JSON.stringify(b);
  markPaid(b);
  assert.equal(JSON.stringify(b), before);
});

test('mark paid advances a 31st bill correctly through a short month and back', () => {
  let b = bill({ dueDate: '2026-01-31', anchorDay: 31 });
  b = markPaid(b).bill; assert.equal(b.dueDate, '2026-02-28');
  b = markPaid(b).bill; assert.equal(b.dueDate, '2026-03-31');
});

test('an EMI counts down its instalments, shows N left, and archives itself at zero', () => {
  let b = bill({ type: 'emi', installmentsLeft: 3, dueDate: '2026-11-05', anchorDay: 5 });
  let r = markPaid(b); assert.deepEqual([r.bill.installmentsLeft, r.bill.archived], [2, false]);
  r = markPaid(r.bill); assert.deepEqual([r.bill.installmentsLeft, r.bill.archived], [1, false]);
  r = markPaid(r.bill);
  assert.deepEqual([r.bill.installmentsLeft, r.bill.archived, r.bill.archivedReason, r.archivedReason], [0, true, 'installments', 'installments']);
  assert.equal(r.bill.dueDate, '2027-02-05'); // still advanced; restoring the earlier state is what Undo does
});

test('a bill is archived when the next due date would pass its end date', () => {
  const r = markPaid(bill({ endDate: '2026-12-31', dueDate: '2026-12-15' }));
  assert.deepEqual([r.bill.archived, r.bill.archivedReason], [true, 'endDate']);
  const keep = markPaid(bill({ endDate: '2026-12-31', dueDate: '2026-11-15' }));
  assert.equal(keep.bill.archived, false); // next is 15 Dec, still before the end
  assert.equal(markPaid(bill({ endDate: '2026-12-15', dueDate: '2026-11-15' })).bill.archived, false); // on the end date is fine
});

test('a one-time item is archived once paid', () => {
  const r = markPaid(bill({ recurrence: 'once' }));
  assert.deepEqual([r.bill.archived, r.bill.archivedReason, r.bill.dueDate], [true, 'paid', '2026-11-15']);
  assert.ok(r.expense); // and it still offers to log the expense
});

test('skip this one: date moves on, no expense, instalments untouched', () => {
  const r = skipOne(bill({ type: 'emi', installmentsLeft: 4 }));
  assert.deepEqual([r.bill.dueDate, r.bill.installmentsLeft, r.bill.archived, 'expense' in r], ['2026-12-15', 4, false, false]);
  assert.equal(skipOne(bill({ recurrence: 'once' })).bill.archivedReason, 'skipped');
  assert.equal(skipOne(bill({ endDate: '2026-11-30' })).bill.archivedReason, 'endDate');
});

test('ended: zero instalments, or due date past the end date; overdue-but-owed is not ended', () => {
  assert.equal(endedReason(bill({ installmentsLeft: 0 })), 'installments');
  assert.equal(endedReason(bill({ installmentsLeft: 1 })), null);
  assert.equal(endedReason(bill({ installmentsLeft: null })), null);
  assert.equal(endedReason(bill({ dueDate: '2026-12-01', endDate: '2026-11-30' })), 'endDate');
  assert.equal(endedReason(bill({ dueDate: '2026-11-30', endDate: '2026-11-30' })), null);
  assert.equal(endedReason(bill({ dueDate: '2026-10-01', endDate: '2026-10-31' })), null); // end passed, but still owed
});

test('the start-up sweep archives finished bills only, keeping the originals for Undo', () => {
  const bills = [bill({ id: 'a', installmentsLeft: 0 }), bill({ id: 'b' }), bill({ id: 'c', dueDate: '2027-01-01', endDate: '2026-12-31' }), bill({ id: 'd', installmentsLeft: 0, archived: true })];
  const swept = sweepEnded(bills);
  assert.deepEqual(swept.map((s) => [s.after.id, s.after.archivedReason]), [['a', 'installments'], ['c', 'endDate']]);
  assert.ok(swept.every((s) => s.before.archived === false && s.after.archived === true));
});

test('upcoming list: only overdue and due-soon, soonest first', () => {
  const named = (id, over) => bill({ id, name: id, ...over });
  const bills = [named('far', { dueDate: '2027-03-01' }), named('soon', { dueDate: '2026-11-27' }), named('late', { dueDate: '2026-11-20' }), named('gone', { dueDate: '2026-11-20', archived: true })];
  assert.deepEqual(needingAttention(bills, '2026-11-25').map((b) => b.id), ['late', 'soon']);
  assert.deepEqual([...bills].sort(byDue).map((b) => b.id), ['gone', 'late', 'soon', 'far'] /* same date: by name */);
});

// ---- mark paid counts an instalment down whether or not it logs an expense ----
test('mark paid counts an instalment down even with “log as expense” switched OFF', () => {
  let b = bill({ type: 'emi', logExpense: false, installmentsLeft: 3, dueDate: '2026-11-05', anchorDay: 5 });
  let r = markPaid(b);
  assert.deepEqual([r.expense, r.bill.installmentsLeft, r.bill.archived, r.bill.dueDate], [null, 2, false, '2026-12-05']);
  r = markPaid(r.bill); assert.deepEqual([r.expense, r.bill.installmentsLeft], [null, 1]);
  r = markPaid(r.bill);
  assert.deepEqual([r.expense, r.bill.installmentsLeft, r.bill.archived, r.bill.archivedReason], [null, 0, true, 'installments']);
  // Same count with logging ON.
  const on = markPaid(bill({ type: 'emi', logExpense: true, installmentsLeft: 3 }));
  assert.equal(on.bill.installmentsLeft, 2);
  assert.ok(on.expense);
});

test('skipping, unlike paying, leaves the instalments alone (with logging on or off)', () => {
  for (const logExpense of [true, false]) assert.equal(skipOne(bill({ type: 'emi', logExpense, installmentsLeft: 3 })).bill.installmentsLeft, 3);
});

// ---- "Last day of month" ----
test('last day of month: the due day tracks month length through a whole year', () => {
  let d = '2026-01-31';
  const seen = [];
  for (let i = 0; i < 12; i++) { d = advanceDue(d, 'monthly', 31); seen.push(d); }
  assert.deepEqual(seen, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
});

test('last day of month differs from a fixed 30th: 30 Nov goes to 31 Dec, not 30 Dec', () => {
  assert.equal(advanceDue('2026-11-30', 'monthly', 30), '2026-12-30'); // fixed day
  assert.equal(advanceDue('2026-11-30', 'monthly', 31), '2026-12-31'); // last day
  assert.equal(advanceDue('2026-02-28', 'monthly', 31), '2026-03-31'); // short February to a 31-day month
  assert.equal(advanceDue('2027-02-28', 'monthly', 28), '2027-03-28'); // while a fixed 28th stays the 28th
});

test('last day of month in leap years and across the year boundary', () => {
  assert.equal(advanceDue('2028-01-31', 'monthly', 31), '2028-02-29');
  assert.equal(advanceDue('2028-02-29', 'monthly', 31), '2028-03-31');
  assert.equal(advanceDue('2100-01-31', 'monthly', 31), '2100-02-28'); // 2100 is not a leap year
  assert.equal(advanceDue('2026-12-31', 'monthly', 31), '2027-01-31');
  assert.equal(advanceDue('2026-11-30', 'quarterly', 31), '2027-02-28');
  assert.equal(advanceDue('2027-02-28', 'quarterly', 31), '2027-05-31');
  assert.equal(advanceDue('2028-02-29', 'yearly', 31), '2029-02-28');
  assert.equal(advanceDue('2027-02-28', 'yearly', 31), '2028-02-29'); // the leap-year February's last day is the 29th
});

test('marking a last-day bill paid walks the month ends', () => {
  let b = bill({ dueDate: '2026-01-31', anchorDay: 31, lastDay: true });
  const seen = [];
  for (let i = 0; i < 4; i++) { b = markPaid(b).bill; seen.push(b.dueDate); }
  assert.deepEqual(seen, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.equal(b.lastDay, true); // paying keeps the option on
  assert.equal(skipOne(bill({ dueDate: '2026-02-28', anchorDay: 31, lastDay: true })).bill.dueDate, '2026-03-31');
});

test('lastDayOfMonth', () => {
  assert.equal(lastDayOfMonth('2026-11-15'), '2026-11-30');
  assert.equal(lastDayOfMonth('2026-02-01'), '2026-02-28');
  assert.equal(lastDayOfMonth('2028-02-10'), '2028-02-29');
  assert.equal(lastDayOfMonth('2026-12-31'), '2026-12-31');
  assert.equal(lastDayOfMonth('2026-04-30'), '2026-04-30');
});

test('switching “last day of month” ON snaps the date to its month end and sets the anchor to 31', () => {
  assert.deepEqual(resolveSchedule({ dueDate: '2026-11-15', lastDay: true }), { dueDate: '2026-11-30', anchorDay: 31, lastDay: true });
  assert.deepEqual(resolveSchedule({ dueDate: '2028-02-10', lastDay: true }), { dueDate: '2028-02-29', anchorDay: 31, lastDay: true });
  // Already on, date unchanged: stays.
  const on = bill({ dueDate: '2026-11-30', anchorDay: 31, lastDay: true });
  assert.deepEqual(resolveSchedule({ dueDate: '2026-11-30', lastDay: true, previous: on }), { dueDate: '2026-11-30', anchorDay: 31, lastDay: true });
  // Picking a mid-month date while on re-snaps it.
  assert.equal(resolveSchedule({ dueDate: '2026-12-10', lastDay: true, previous: on }).dueDate, '2026-12-31');
});

test('switching it OFF keeps the date shown and makes it an ordinary fixed due day', () => {
  const on = bill({ dueDate: '2026-02-28', anchorDay: 31, lastDay: true });
  assert.deepEqual(resolveSchedule({ dueDate: '2026-02-28', lastDay: false, previous: on }), { dueDate: '2026-02-28', anchorDay: 28, lastDay: false });
  // ...and from then on it stays on the 28th.
  let b = { ...on, ...resolveSchedule({ dueDate: '2026-02-28', lastDay: false, previous: on }) };
  assert.equal(markPaid(b).bill.dueDate, '2026-03-28');
  assert.equal(advanceDue('2026-03-28', 'monthly', b.anchorDay), '2026-04-28');
});

test('switching it on and off again round-trips sensibly', () => {
  const fixed = bill({ dueDate: '2026-11-15', anchorDay: 15, lastDay: false });
  const on = { ...fixed, ...resolveSchedule({ dueDate: fixed.dueDate, lastDay: true, previous: fixed }) };
  assert.deepEqual([on.dueDate, on.anchorDay, on.lastDay], ['2026-11-30', 31, true]);
  const off = { ...on, ...resolveSchedule({ dueDate: on.dueDate, lastDay: false, previous: on }) };
  assert.deepEqual([off.dueDate, off.anchorDay, off.lastDay], ['2026-11-30', 30, false]); // the 30th now, a fixed day
  const again = { ...off, ...resolveSchedule({ dueDate: off.dueDate, lastDay: true, previous: off }) };
  assert.deepEqual([again.dueDate, again.anchorDay, again.lastDay], ['2026-11-30', 31, true]);
  assert.equal(markPaid(again).bill.dueDate, '2026-12-31');
  assert.equal(markPaid(off).bill.dueDate, '2026-12-30');
});

test('a fixed-day bill keeps its day when edited without changing the date, and a changed date resets it', () => {
  const b = bill({ dueDate: '2026-02-28', anchorDay: 31, lastDay: false }); // a 31st bill sitting on 28 Feb
  assert.equal(resolveSchedule({ dueDate: '2026-02-28', lastDay: false, previous: b }).anchorDay, 31);
  assert.equal(resolveSchedule({ dueDate: '2026-03-10', lastDay: false, previous: b }).anchorDay, 10);
  assert.equal(resolveSchedule({ dueDate: '2026-03-10', lastDay: false }).anchorDay, 10); // a new bill
});
