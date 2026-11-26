// Backup file format, validation and the "time to back up" reminder. Pure: tests/backup.test.js.
// An import is checked completely before anything is replaced; a bad file changes nothing.

import { isPaise, isSignedPaise } from './money.js';
import { BILL_TYPES, RECURRENCES } from './bills.js';
import { withIcon } from './seed.js';
import { validateCycles } from './cycles.js';
import { hasIcon } from './icons.js';
import { isYmd, isMonth } from './dates.js';
import { APP_VERSION, SCHEMA_VERSION } from './version.js';

export const BACKUP_APP = 'crux';
export const REMINDER_DAYS = 14;
const DAY_MS = 86_400_000;
const MAX_TEXT = 200;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function buildBackup({ categories, budgets, entries, goals = [], goalAdds = [], bills = [], income = [], incomeSources = [], periodSettings, cycles = [], cycleBudgets = {} }, now = new Date()) {
  return {
    app: BACKUP_APP,
    schema: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    categories,
    budgets,
    entries,
    goals,
    goalAdds,
    bills,
    income,
    incomeSources,
    periodSettings: periodSettings ?? { mode: 'month', nthLast: 2, holidays: [] },
    cycles,
    cycleBudgets,
  };
}

export const backupFileName = (ymd) => `crux-backup-${ymd}.json`;

const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Parse and validate a backup file's text. Returns { ok: true, data, counts } or { ok: false, error }. */
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file isn’t valid JSON.' };
  }
  if (!raw || typeof raw !== 'object' || raw.app !== BACKUP_APP) return { ok: false, error: 'This isn’t a CRUX backup file.' };
  if (!Number.isInteger(raw.schema) || raw.schema > SCHEMA_VERSION) return { ok: false, error: 'This backup comes from a newer version of CRUX. Update the app first.' };
  if (!Array.isArray(raw.categories) || !Array.isArray(raw.entries) || !raw.budgets || typeof raw.budgets !== 'object' || Array.isArray(raw.budgets)) {
    return { ok: false, error: 'The backup is missing categories, budgets or entries.' };
  }

  const categories = [];
  const catIds = new Set();
  for (const [i, c] of raw.categories.entries()) {
    if (!c || !ID.test(c.id) || catIds.has(c.id) || !str(c.name).trim()) return { ok: false, error: `Category ${i + 1} is damaged.` };
    catIds.add(c.id);
    categories.push(withIcon({
      id: c.id,
      name: str(c.name, 40).trim(),
      icon: typeof c.icon === 'string' && hasIcon(c.icon) ? c.icon : undefined, // older backups: mapped by name below
      emoji: str(c.emoji, 16),
      color: COLOR.test(c.color) ? c.color : '#7C8796',
      order: Number.isFinite(c.order) ? c.order : i,
      archived: c.archived === true,
      createdAt: Number.isFinite(c.createdAt) ? c.createdAt : 0,
    }, { valid: hasIcon, index: i }));
  }

  const budgets = {};
  for (const [month, plan] of Object.entries(raw.budgets)) {
    if (!isMonth(month) || !plan || typeof plan !== 'object') return { ok: false, error: `The budget for ${month} is damaged.` };
    budgets[month] = {};
    for (const [id, paise] of Object.entries(plan)) {
      if (!catIds.has(id) || !isPaise(paise)) return { ok: false, error: `The budget for ${month} is damaged.` };
      budgets[month][id] = paise;
    }
  }

  const entries = [];
  const entryIds = new Set();
  for (const [i, e] of raw.entries.entries()) {
    if (!e || !ID.test(e.id) || entryIds.has(e.id) || !catIds.has(e.categoryId) || !isPaise(e.amount) || e.amount === 0 || !isYmd(e.date)) {
      return { ok: false, error: `Entry ${i + 1} is damaged.` };
    }
    entryIds.add(e.id);
    entries.push({
      id: e.id,
      amount: e.amount,
      categoryId: e.categoryId,
      date: e.date,
      note: str(e.note),
      createdAt: Number.isFinite(e.createdAt) ? e.createdAt : 0,
      updatedAt: Number.isFinite(e.updatedAt) ? e.updatedAt : 0,
    });
  }

  // Goals and bills arrived with schema 2. A 1.0.x backup has none: it imports cleanly, and the caller keeps
  // whatever goals and bills are on the device (hasGoalData: false).
  const hasGoalData = raw.schema >= 2;
  let goals = [];
  let goalAdds = [];
  let bills = [];
  if (hasGoalData) {
    const g = parseGoalData(raw, catIds);
    if (!g.ok) return g;
    ({ goals, goalAdds, bills } = g);
  }

  // Income arrived with schema 3. A backup from 1.0.x or 1.1.x has none: it imports cleanly, and the caller keeps the
  // income and recurring sources already on the device (hasIncomeData: false).
  const hasIncomeData = raw.schema >= 3;
  let income = [];
  let incomeSources = [];
  if (hasIncomeData) {
    const r = parseIncomeData(raw);
    if (!r.ok) return r;
    ({ income, incomeSources } = r);
  }

  // Pay cycles arrived with schema 4. An older backup imports in calendar-month mode, with no cycles.
  const hasCycleData = raw.schema >= 4;
  let periodSettings = { mode: 'month', nthLast: 2, holidays: [] };
  let cycles = [];
  let cycleBudgets = {};
  if (hasCycleData) {
    const r = parseCycleData(raw, catIds);
    if (!r.ok) return r;
    ({ periodSettings, cycles, cycleBudgets } = r);
  }

  return {
    ok: true,
    data: { categories, budgets, entries, goals, goalAdds, bills, income, incomeSources, periodSettings, cycles, cycleBudgets },
    hasCycleData,
    hasGoalData,
    hasIncomeData,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
    counts: { categories: categories.length, entries: entries.length, months: Object.keys(budgets).length, goals: goals.length, goalAdds: goalAdds.length, bills: bills.length, income: income.length, incomeSources: incomeSources.length, cycles: cycles.length },
  };
}

const bad = (error) => ({ ok: false, error });
const orNull = (v) => (v === undefined ? null : v);
const BILL_TYPE_IDS = BILL_TYPES.map((t) => t.id);
const RECURRENCE_IDS = RECURRENCES.map((r) => r.id);

function parseGoalData(raw, catIds) {
  if (!Array.isArray(raw.goals) || !Array.isArray(raw.goalAdds) || !Array.isArray(raw.bills)) return bad('The backup is missing goals or bills.');

  const goals = [];
  const goalIds = new Set();
  const bucketIds = new Map(); // goalId → Set of bucket ids
  for (const [i, g] of raw.goals.entries()) {
    if (!g || !ID.test(g.id) || goalIds.has(g.id) || !str(g.name).trim()) return bad(`Goal ${i + 1} is damaged.`);
    const target = orNull(g.target) ?? 0;
    const plan = orNull(g.monthlyPlan) ?? 0;
    const date = orNull(g.targetDate);
    if (!isPaise(target) || !isPaise(plan) || (date !== null && !isYmd(date)) || !Array.isArray(g.buckets ?? [])) return bad(`Goal ${i + 1} is damaged.`);
    const ids = new Set();
    const buckets = [];
    for (const b of g.buckets ?? []) {
      if (!b || !ID.test(b.id) || ids.has(b.id) || !str(b.name).trim()) return bad(`A bucket in goal ${i + 1} is damaged.`);
      ids.add(b.id);
      buckets.push({ id: b.id, name: str(b.name, 40).trim() });
    }
    goalIds.add(g.id);
    bucketIds.set(g.id, ids);
    goals.push(withIcon({
      id: g.id,
      name: str(g.name, 40).trim(),
      icon: typeof g.icon === 'string' && hasIcon(g.icon) ? g.icon : undefined,
      color: COLOR.test(g.color) ? g.color : undefined,
      emoji: str(g.emoji, 16),
      target,
      targetDate: date,
      monthlyPlan: plan,
      buckets,
      archived: g.archived === true,
      order: Number.isFinite(g.order) ? g.order : i,
      createdAt: Number.isFinite(g.createdAt) ? g.createdAt : 0,
    }, { valid: hasIcon, index: i }));
  }

  const goalAdds = [];
  const addIds = new Set();
  for (const [i, a] of raw.goalAdds.entries()) {
    const bucketId = orNull(a?.bucketId);
    if (!a || !ID.test(a.id) || addIds.has(a.id) || !goalIds.has(a.goalId) || !isSignedPaise(a.amount) || a.amount === 0 || !isYmd(a.date)
      || (bucketId !== null && !bucketIds.get(a.goalId).has(bucketId))) return bad(`Goal entry ${i + 1} is damaged.`);
    addIds.add(a.id);
    goalAdds.push({ id: a.id, goalId: a.goalId, amount: a.amount, date: a.date, note: str(a.note), bucketId, createdAt: Number.isFinite(a.createdAt) ? a.createdAt : 0 });
  }

  const bills = [];
  const billIds = new Set();
  for (const [i, b] of raw.bills.entries()) {
    const amount = orNull(b?.amount);
    const endDate = orNull(b?.endDate);
    const left = orNull(b?.installmentsLeft);
    const categoryId = orNull(b?.categoryId);
    const dueOk = b && isYmd(b.dueDate);
    if (!b || !ID.test(b.id) || billIds.has(b.id) || !str(b.name).trim() || !BILL_TYPE_IDS.includes(b.type) || !RECURRENCE_IDS.includes(b.recurrence) || !dueOk
      || (amount !== null && !isPaise(amount)) || (endDate !== null && !isYmd(endDate)) || (left !== null && !(Number.isInteger(left) && left >= 0 && left <= 1200))
      || (categoryId !== null && !catIds.has(categoryId)) || !(Number.isInteger(b.warnDays) && b.warnDays >= 0 && b.warnDays <= 90)) return bad(`Bill ${i + 1} is damaged.`);
    const lastDay = b.lastDay === true; // absent in files from 1.1.0: a fixed due day
    const anchor = lastDay ? 31 : Number.isInteger(b.anchorDay) && b.anchorDay >= 1 && b.anchorDay <= 31 ? b.anchorDay : Number(b.dueDate.slice(8));
    billIds.add(b.id);
    bills.push({
      id: b.id,
      name: str(b.name, 60).trim(),
      type: b.type,
      amount,
      recurrence: b.recurrence,
      dueDate: b.dueDate,
      anchorDay: anchor,
      lastDay,
      warnDays: b.warnDays,
      endDate,
      installmentsLeft: left,
      note: str(b.note),
      categoryId,
      logExpense: b.logExpense !== false,
      archived: b.archived === true,
      archivedReason: typeof b.archivedReason === 'string' ? b.archivedReason.slice(0, 20) : null,
      createdAt: Number.isFinite(b.createdAt) ? b.createdAt : 0,
    });
  }
  return { ok: true, goals, goalAdds, bills };
}

function parseCycleData(raw, catIds) {
  const s = raw.periodSettings;
  if (!s || !['cycle', 'month'].includes(s.mode) || !Number.isInteger(s.nthLast) || s.nthLast < 1 || s.nthLast > 10
    || !Array.isArray(s.holidays) || s.holidays.length > 400 || !s.holidays.every(isYmd)) return bad('The budget period settings are damaged.');
  if (!Array.isArray(raw.cycles) || !raw.cycleBudgets || typeof raw.cycleBudgets !== 'object' || Array.isArray(raw.cycleBudgets)) return bad('The backup is missing its pay cycles.');
  const cycles = [];
  for (const c of raw.cycles) {
    if (!c || !isYmd(c.start) || !['rule', 'confirmed'].includes(c.source)) return bad('A pay cycle in the backup is damaged.');
    cycles.push({ start: c.start, source: c.source });
  }
  const settings = { mode: s.mode, nthLast: s.nthLast, holidays: [...new Set(s.holidays)].sort() };
  if (cycles.length && validateCycles(cycles, settings)) return bad('The pay cycles in the backup overlap or are damaged.');
  const cycleBudgets = {};
  for (const [key, plan] of Object.entries(raw.cycleBudgets)) {
    if (!isMonth(key) || !plan || typeof plan !== 'object') return bad(`The cycle budget for ${key} is damaged.`);
    cycleBudgets[key] = {};
    for (const [id, paise] of Object.entries(plan)) {
      if (!catIds.has(id) || !isPaise(paise)) return bad(`The cycle budget for ${key} is damaged.`);
      cycleBudgets[key][id] = paise;
    }
  }
  return { ok: true, periodSettings: settings, cycles, cycleBudgets };
}

function parseIncomeData(raw) {
  if (!Array.isArray(raw.income) || !Array.isArray(raw.incomeSources)) return bad('The backup is missing income.');
  const sources = [];
  const sourceIds = new Set();
  for (const [i, s] of raw.incomeSources.entries()) {
    const amount = orNull(s?.amount);
    if (!s || !ID.test(s.id) || sourceIds.has(s.id) || !str(s.name).trim() || (amount !== null && !isPaise(amount)) || !isYmd(s.nextDate)) return bad(`Recurring income ${i + 1} is damaged.`);
    const lastDay = s.lastDay === true;
    const anchor = lastDay ? 31 : Number.isInteger(s.anchorDay) && s.anchorDay >= 1 && s.anchorDay <= 31 ? s.anchorDay : Number(s.nextDate.slice(8));
    sourceIds.add(s.id);
    sources.push({ id: s.id, name: str(s.name, 40).trim(), amount, nextDate: s.nextDate, anchorDay: anchor, lastDay, note: str(s.note), archived: s.archived === true, createdAt: Number.isFinite(s.createdAt) ? s.createdAt : 0 });
  }
  const entries = [];
  const ids = new Set();
  for (const [i, e] of raw.income.entries()) {
    const sourceId = orNull(e?.sourceId);
    if (!e || !ID.test(e.id) || ids.has(e.id) || !str(e.source).trim() || !isPaise(e.amount) || e.amount === 0 || !isYmd(e.date) || (sourceId !== null && !sourceIds.has(sourceId))) return bad(`Income entry ${i + 1} is damaged.`);
    ids.add(e.id);
    entries.push({ id: e.id, sourceId, source: str(e.source, 40).trim(), amount: e.amount, date: e.date, note: str(e.note), createdAt: Number.isFinite(e.createdAt) ? e.createdAt : 0 });
  }
  return { ok: true, income: entries, incomeSources: sources };
}

/** Show the backup reminder when there's data and the last export is missing or over 14 days old. */
export function needsBackupReminder(lastExportMs, nowMs, hasData) {
  if (!hasData) return false;
  if (!Number.isFinite(lastExportMs)) return true;
  return nowMs - lastExportMs > REMINDER_DAYS * DAY_MS;
}

export function daysSince(ms, nowMs) {
  return Math.floor((nowMs - ms) / DAY_MS);
}
