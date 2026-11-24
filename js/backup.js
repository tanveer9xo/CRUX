// Backup file format, validation and the "time to back up" reminder. Pure: tests/backup.test.js.
// An import is checked completely before anything is replaced; a bad file changes nothing.

import { isPaise } from './money.js';
import { isYmd, isMonth } from './dates.js';
import { APP_VERSION, SCHEMA_VERSION } from './version.js';

export const BACKUP_APP = 'crux';
export const REMINDER_DAYS = 14;
const DAY_MS = 86_400_000;
const MAX_TEXT = 200;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function buildBackup({ categories, budgets, entries }, now = new Date()) {
  return {
    app: BACKUP_APP,
    schema: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    categories,
    budgets,
    entries,
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
    categories.push({
      id: c.id,
      name: str(c.name, 40).trim(),
      emoji: str(c.emoji, 16),
      color: COLOR.test(c.color) ? c.color : '#7C8796',
      order: Number.isFinite(c.order) ? c.order : i,
      archived: c.archived === true,
      createdAt: Number.isFinite(c.createdAt) ? c.createdAt : 0,
    });
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

  return {
    ok: true,
    data: { categories, budgets, entries },
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
    counts: { categories: categories.length, entries: entries.length, months: Object.keys(budgets).length },
  };
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
