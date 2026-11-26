// Pay cycles. A cycle starts on salary day and ends the day before the next one. Pure: tests/cycles.test.js.
//   rule:     the start is the Nth-last working day (Mon–Fri, minus holidays) of a calendar month (default N = 2).
//   records:  the actual starts are stored as data: [{ start: "YYYY-MM-DD", source: "rule" | "confirmed" }].
//             Past cycles never change when the rule or the holidays change; only the predicted future does.
//   naming:   a cycle is named after the calendar month holding most of its days (ties → the later month), so
//             29 Oct – 26 Nov is "November", and every year has twelve cycles. Names are unique (see validate).
import { parseYmd, toYmd, daysInMonth, addMonths, monthOf, addDays, daysBetween, firstDay, lastDay, rangeLabel } from './dates.js';

export const DEFAULT_PERIOD_SETTINGS = { mode: 'cycle', nthLast: 2, holidays: [] };
/** Two rule starts are at least this many days apart; a confirmation this close to an expected start replaces it. */
export const MIN_GAP = 15;

/** 0 = Sunday … 6 = Saturday, by calendar date (no time zone involved). */
export function weekday(ymd) {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const isWorkingDay = (ymd, holidays = []) => { const w = weekday(ymd); return w !== 0 && w !== 6 && !holidays.includes(ymd); };

/** The Nth-last working day of a month: N = 1 is the last working day, N = 2 the one before it. */
export function nthLastWorkingDay(month, n = 2, holidays = []) {
  const [y, m] = month.split('-').map(Number);
  let count = 0;
  for (let d = daysInMonth(y, m); d >= 1; d--) {
    const ymd = toYmd(y, m, d);
    if (isWorkingDay(ymd, holidays) && ++count === n) return ymd;
  }
  return firstDay(month); // fewer than N working days: only for unrealistic settings
}

const rule = (month, s) => nthLastWorkingDay(month, s.nthLast ?? 2, s.holidays ?? []);

/** The first rule start at least MIN_GAP days after `after` (handles late and early salaries without skipping a month). */
export function nextRuleStart(after, settings) {
  const min = addDays(after, MIN_GAP);
  for (let i = 0; i < 4; i++) {
    const s = rule(addMonths(monthOf(after), i), settings);
    if (s >= min) return s;
  }
  return rule(addMonths(monthOf(after), 4), settings);
}

/** The rule's latest start on or before a date. */
export function ruleStartOnOrBefore(ymd, settings) {
  const own = rule(monthOf(ymd), settings);
  return own <= ymd ? own : rule(addMonths(monthOf(ymd), -1), settings);
}

/** The calendar month ("YYYY-MM") that holds most of the days from start to end; ties go to the later month. */
export function cycleName(start, end) {
  let best = null;
  let bestDays = -1;
  for (let m = monthOf(start); m <= monthOf(end); m = addMonths(m, 1)) {
    const from = firstDay(m) > start ? firstDay(m) : start;
    const to = lastDay(m) < end ? lastDay(m) : end;
    const n = daysBetween(from, to) + 1;
    if (n >= bestDays) { best = m; bestDays = n; } // ">=": a tie goes to the later month
  }
  return best;
}

const sortRecords = (records) => [...records].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

/**
 * Cycle objects from the stored records: { key (name month), start, end, days, source, endExpected }.
 * The last cycle ends the day before the rule's predicted next start (endExpected: true).
 */
export function buildCycles(records, settings) {
  const r = sortRecords(records);
  return r.map((c, i) => {
    const next = r[i + 1]?.start ?? nextRuleStart(c.start, settings);
    const end = addDays(next, -1);
    return { key: cycleName(c.start, end), start: c.start, end, days: daysBetween(c.start, next), source: c.source, endExpected: !r[i + 1] };
  });
}

/**
 * Make sure stored cycles cover `from` (the earliest data date) through `today`, adding rule cycles as needed.
 * Returns { records, added }. Existing records are never changed.
 */
export function ensureCycles(records, settings, today, from = today) {
  let r = sortRecords(records);
  const added = [];
  const push = (start, atStart = false) => { const rec = { start, source: 'rule' }; added.push(rec); r = atStart ? [rec, ...r] : [...r, rec]; };
  if (!r.length) push(ruleStartOnOrBefore(from < today ? from : today, settings));
  while (r[0].start > from) push(ruleStartOnOrBefore(addDays(r[0].start, -MIN_GAP), settings), true);
  for (let next = nextRuleStart(r.at(-1).start, settings); next <= today; next = nextRuleStart(r.at(-1).start, settings)) push(next);
  return { records: sortRecords(r), added };
}

/** Problems with a set of records: overlaps, zero-length cycles, or two cycles with the same name. null if fine. */
export function validateCycles(records, settings) {
  const r = sortRecords(records);
  for (let i = 1; i < r.length; i++) if (r[i].start <= r[i - 1].start) return 'Two cycles can’t start on the same day.';
  const cycles = buildCycles(r, settings);
  if (cycles.some((c) => c.days < 1)) return 'A cycle must be at least one day long.';
  const seen = new Map();
  for (const c of cycles) {
    if (seen.has(c.key)) return `That would make two cycles named after the same month (${c.key}). Pick a date nearer the usual salary day.`;
    seen.set(c.key, c);
  }
  return null;
}

/**
 * "Salary received" / "Start new cycle now": the next cycle starts on `date` and is confirmed.
 * If the latest cycle is only an expected (rule) start within MIN_GAP days of `date`, the salary is that cycle's
 * salary arriving early or late, so its start moves to `date`. Otherwise a new cycle begins on `date`.
 * Returns { records, error }.
 */
export function confirmStart(records, date, settings) {
  const r = sortRecords(records);
  const last = r.at(-1);
  let next;
  if (last && last.source === 'rule' && Math.abs(daysBetween(last.start, date)) < MIN_GAP) next = [...r.slice(0, -1), { start: date, source: 'confirmed' }];
  else if (last && date <= last.start) return { records: r, error: date === last.start ? 'The current cycle already starts on that day.' : 'That date is before the current cycle’s start. Edit that cycle’s start instead.' };
  else next = [...r, { start: date, source: 'confirmed' }];
  const error = validateCycles(next, settings);
  return error ? { records: r, error } : { records: sortRecords(next), error: null };
}

/** Move one cycle's start (`from` → `to`), confirmed. Rejects overlaps and zero-length or same-named cycles. */
export function editStart(records, from, to, settings) {
  const r = sortRecords(records);
  const i = r.findIndex((c) => c.start === from);
  if (i < 0) return { records: r, error: 'That cycle no longer exists.' };
  if (i > 0 && to <= r[i - 1].start) return { records: r, error: 'That would overlap the cycle before it.' };
  if (i < r.length - 1 && to >= r[i + 1].start) return { records: r, error: 'That would overlap the cycle after it.' };
  const next = r.map((c, j) => (j === i ? { start: to, source: 'confirmed' } : c));
  const error = validateCycles(next, settings);
  return error ? { records: r, error } : { records: next, error: null };
}

/** The cycle (from buildCycles) containing a date, or null if before the first one. Past the last: null. */
export function cycleOf(cycles, ymd) {
  let lo = 0;
  let hi = cycles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cycles[mid].start > ymd) hi = mid - 1;
    else if (cycles[mid].end < ymd) lo = mid + 1;
    else return cycles[mid];
  }
  return null;
}

/** Entries whose cycle changes between two cycle sets: [{ entry, from, to }] (keys are cycle names). For previews. */
export function movedEntries(entries, before, after) {
  const out = [];
  for (const e of entries) {
    const a = cycleOf(before, e.date)?.key ?? null;
    const b = cycleOf(after, e.date)?.key ?? null;
    if (a !== b) out.push({ entry: e, from: a, to: b });
  }
  return out;
}

/** Day number within a cycle (the start is day 1). */
export const dayOfCycle = (cycle, ymd) => daysBetween(cycle.start, ymd) + 1;

/**
 * Same-day-of-cycle window in the previous cycle: day N of this cycle against days 1..N of the previous one, clamped
 * to its end (so a long cycle's day 35 compares with all of a 28-day previous cycle).
 */
export function previousWindow(prev, dayNumber) {
  const to = addDays(prev.start, dayNumber - 1);
  return { from: prev.start, to: to < prev.end ? to : prev.end };
}

/** Days left in a cycle from `today`, today included (the last day gives 1). */
export const daysLeftInCycle = (cycle, today) => daysBetween(today, cycle.end) + 1;

export const cycleRange = (c) => rangeLabel2(c.start, c.end);
function rangeLabel2(a, b) {
  return monthOf(a) === monthOf(b) ? rangeLabel(a, b) : `${rangeLabel(a, a)} – ${rangeLabel(b, b)}`;
}
