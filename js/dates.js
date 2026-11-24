// Calendar dates as plain strings: a day is "YYYY-MM-DD", a month is "YYYY-MM", both in local time.
// Strings sort and compare correctly, survive JSON, and never shift with time zones.
// Pure functions: tests/dates.test.js runs them in several time zones.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');

export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days in month m (1–12) of year y: 28, 29, 30 or 31. */
export function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Today's local date as "YYYY-MM-DD". */
export function todayYmd(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export const toYmd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const toMonth = (y, m) => `${y}-${pad(m)}`;

/** A real calendar date in "YYYY-MM-DD" form (rejects 2026-02-30). */
export function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseYmd(s);
  return y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function isMonth(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
  const [y, m] = s.split('-').map(Number);
  return y >= 1900 && y <= 9999 && m >= 1 && m <= 12;
}

/** "2026-11-24" → "2026-11" */
export const monthOf = (ymd) => ymd.slice(0, 7);

/** Shift a month key by n months (negative goes back): addMonths("2026-01", -1) → "2025-12". */
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return toMonth(Math.floor(idx / 12), (idx % 12) + 1);
}

export const firstDay = (month) => `${month}-01`;
export function lastDay(month) {
  const [y, m] = month.split('-').map(Number);
  return toYmd(y, m, daysInMonth(y, m));
}

/**
 * The same day of the month, one month earlier, clamped to that month's length:
 * 24 Nov → 24 Oct, 31 Mar → 28 Feb (29 in a leap year), 30 May → 30 Apr, 31 Jan → 31 Dec.
 */
export function sameDayLastMonth(ymd) {
  const { y, m, d } = parseYmd(ymd);
  const pm = addMonths(toMonth(y, m), -1);
  const [py, pmm] = pm.split('-').map(Number);
  return toYmd(py, pmm, Math.min(d, daysInMonth(py, pmm)));
}

/** Days from ymd to the end of its month, counting ymd itself (the last day of a month gives 1). */
export function daysLeftInMonth(ymd) {
  const { y, m, d } = parseYmd(ymd);
  return daysInMonth(y, m) - d + 1;
}

/** The n months ending at (and including) `month`, oldest first. */
export function monthsEnding(month, n) {
  return Array.from({ length: n }, (_, i) => addMonths(month, i - n + 1));
}

/** Shift a day by n days. */
export function addDays(ymd, n) {
  const { y, m, d } = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function monthLabel(month, { short = false } = {}) {
  const [y, m] = month.split('-').map(Number);
  return short ? `${MONTHS[m - 1].slice(0, 3)} ${y}` : `${MONTHS[m - 1]} ${y}`;
}
export const monthName = (month, short = true) => {
  const n = MONTHS[Number(month.slice(5, 7)) - 1];
  return short ? n.slice(0, 3) : n;
};

/** "Tue, 24 Nov" (UTC maths so the weekday never depends on the time zone). */
export function dayLabel(ymd) {
  const { y, m, d } = parseYmd(ymd);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[wd]}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** "1–24 Nov" */
export function rangeLabel(from, to) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  const mon = MONTHS[b.m - 1].slice(0, 3);
  return a.d === b.d ? `${b.d} ${mon}` : `${a.d}–${b.d} ${mon}`;
}
