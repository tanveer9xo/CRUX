// Bills and renewals: due-date maths and the mark-paid / skip / auto-archive rules. Pure: tests/bills.test.js.
//   bill: { id, name, type, amount (paise|null), recurrence, dueDate, anchorDay, warnDays, endDate|null,
//           installmentsLeft|null, note, categoryId|null, logExpense, lastDay, archived, archivedReason|null }
// `anchorDay` is the day of month the bill is really due. dueDate can sit earlier (28 Feb for a bill due on the
// 31st) and snaps back to the anchor in months that have it.
// `lastDay` ("Last day of month") makes the due day track month length: 28/29/30/31, whichever the month's last day
// is. It is stored with anchorDay 31, so the same clamping rules advance it; the flag is what the form shows, and what
// lets switching it off fall back to an ordinary fixed due day.

import { addMonthsClamped, daysBetween, dayLabel, parseYmd, lastDay, monthOf } from './dates.js';

export const BILL_TYPES = [
  { id: 'cc', label: 'Credit card due', emoji: '💳', color: '#9085E9' },
  { id: 'emi', label: 'EMI', emoji: '🏦', color: '#3987E5' },
  { id: 'insurance', label: 'Insurance', emoji: '🛡️', color: '#4FB6D9' },
  { id: 'subscription', label: 'Subscription', emoji: '🔁', color: '#B06BD8' },
  { id: 'bill', label: 'Bill', emoji: '🧾', color: '#D8C23A' },
  { id: 'other', label: 'Other', emoji: '📌', color: '#7C8796' },
];
export const RECURRENCES = [
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'quarterly', label: 'Quarterly', months: 3 },
  { id: 'yearly', label: 'Yearly', months: 12 },
  { id: 'once', label: 'One-time', months: 0 },
];
export const DEFAULT_WARN_DAYS = 3;

export const typeInfo = (id) => BILL_TYPES.find((t) => t.id === id) ?? BILL_TYPES.at(-1);
export const recurrenceInfo = (id) => RECURRENCES.find((r) => r.id === id) ?? RECURRENCES[0];

/**
 * Whether marking paid logs an expense by default. Credit card dues default to OFF: the card's purchases are
 * already logged as expenses, so logging the bill as well would count the money twice.
 */
export const defaultLogExpense = (type) => type !== 'cc';

/** The last day of the month `ymd` falls in. */
export const lastDayOfMonth = (ymd) => lastDay(monthOf(ymd));

/**
 * The schedule fields to store for a chosen due date.
 *  - "Last day of month" ON: the date snaps to its month's last day and the anchor is 31 (so every later month's
 *    last day, whatever its length).
 *  - OFF: the date is kept as chosen and the due day is that date's day. If the bill already had a fixed due day
 *    and the date is unchanged, that day is kept (28 Feb on a "31st" bill stays a 31st bill). A bill that was on
 *    "last day" and is switched off becomes a fixed-day bill on the date shown.
 */
export function resolveSchedule({ dueDate, lastDay: on, previous = null }) {
  if (on) return { dueDate: lastDayOfMonth(dueDate), anchorDay: 31, lastDay: true };
  const keep = previous && !previous.lastDay && previous.dueDate === dueDate;
  return { dueDate, anchorDay: keep ? previous.anchorDay : parseYmd(dueDate).d, lastDay: false };
}

/** The next due date after `dueDate`, or null for a one-time item. */
export function advanceDue(dueDate, recurrence, anchorDay) {
  const months = recurrenceInfo(recurrence).months;
  if (!months) return null;
  return addMonthsClamped(dueDate, months, anchorDay ?? parseYmd(dueDate).d);
}

/** Days until due (negative = overdue) and the state: 'overdue' | 'soon' (inside the warning window) | 'later'. */
export function billStatus(bill, today) {
  const days = daysBetween(today, bill.dueDate);
  return { days, state: days < 0 ? 'overdue' : days <= bill.warnDays ? 'soon' : 'later' };
}

/**
 * Why a bill is finished, or null. Out of instalments, or its next due date falls after the end date.
 * (An overdue bill whose due date is still on or before the end date is not finished: it is still owed.)
 */
export function endedReason(bill) {
  if (bill.installmentsLeft !== null && bill.installmentsLeft !== undefined && bill.installmentsLeft <= 0) return 'installments';
  if (bill.endDate && bill.dueDate > bill.endDate) return 'endDate';
  return null;
}

const archive = (bill, reason) => ({ ...bill, archived: true, archivedReason: reason });

/**
 * Mark paid: one instalment down, due date on by one period (a one-time item is finished), auto-archived when it
 * has run out. `expense` is the prefill for the optional "log an expense" step, or null when this bill doesn't log.
 */
export function markPaid(bill) {
  let next = { ...bill };
  if (next.installmentsLeft !== null && next.installmentsLeft !== undefined) next.installmentsLeft = Math.max(0, next.installmentsLeft - 1);
  const due = advanceDue(bill.dueDate, bill.recurrence, bill.anchorDay);
  if (due === null) next = archive(next, 'paid');
  else {
    next.dueDate = due;
    const reason = endedReason(next);
    if (reason) next = archive(next, reason);
  }
  const expense = bill.logExpense ? { amount: bill.amount > 0 ? bill.amount : null, categoryId: bill.categoryId ?? null, note: bill.name } : null;
  return { bill: next, expense, archivedReason: next.archived ? next.archivedReason : null };
}

/** Skip this one: the date moves on with no expense, and instalments left stay as they were. */
export function skipOne(bill) {
  const due = advanceDue(bill.dueDate, bill.recurrence, bill.anchorDay);
  if (due === null) return { bill: archive(bill, 'skipped'), archivedReason: 'skipped' };
  const next = { ...bill, dueDate: due };
  const reason = endedReason(next);
  return reason ? { bill: archive(next, reason), archivedReason: reason } : { bill: next, archivedReason: null };
}

/** Bills that are finished but not yet archived: [{ before, after }] for the start-up sweep. */
export function sweepEnded(bills) {
  return bills.filter((b) => !b.archived && endedReason(b)).map((b) => ({ before: b, after: archive(b, endedReason(b)) }));
}

export const byDue = (a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name));

/** Active bills that are overdue or inside their warning window, soonest first. */
export function needingAttention(bills, today) {
  return bills.filter((b) => !b.archived && billStatus(b, today).state !== 'later').sort(byDue);
}

export function dueText(bill, today) {
  const { days } = billStatus(bill, today);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue · ${dayLabel(bill.dueDate)}`;
  if (days === 0) return `Due today · ${dayLabel(bill.dueDate)}`;
  if (days === 1) return `Due tomorrow · ${dayLabel(bill.dueDate)}`;
  return `${dayLabel(bill.dueDate)} · in ${days} days`;
}

export const ARCHIVE_REASONS = { paid: 'Paid', skipped: 'Skipped', installments: 'No instalments left', endDate: 'Past its end date', manual: 'Archived' };
