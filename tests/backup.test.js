import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, needsBackupReminder } from '../js/backup.js';

const DAY = 86_400_000;
const sample = () => ({
  categories: [{ id: 'food', name: 'Groceries', emoji: '🛒', color: '#3DDC97', order: 0, archived: false, createdAt: 1 }],
  budgets: { '2026-11': { food: 800000 } },
  entries: [{ id: 'e1', amount: 25050, categoryId: 'food', date: '2026-11-24', note: 'veg', createdAt: 2, updatedAt: 2 }],
});

test('a backup round-trips exactly', () => {
  const file = JSON.stringify(buildBackup(sample(), new Date('2026-11-24T10:00:00Z')));
  const r = parseBackup(file);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.data, sample());
  assert.deepEqual(r.counts, { categories: 1, entries: 1, months: 1 });
  assert.equal(r.exportedAt, '2026-11-24T10:00:00.000Z');
});

test('imports are rejected whole when anything is wrong', () => {
  const bad = (mutate) => {
    const b = buildBackup(sample());
    mutate(b);
    return parseBackup(JSON.stringify(b));
  };
  assert.equal(parseBackup('not json').ok, false);
  assert.equal(parseBackup('{"app":"vane"}').ok, false); // another app's backup
  assert.equal(bad((b) => { b.entries[0].amount = 250.5; }).ok, false); // float rupees, not paise
  assert.equal(bad((b) => { b.entries[0].amount = -100; }).ok, false);
  assert.equal(bad((b) => { b.entries[0].amount = 0; }).ok, false);
  assert.equal(bad((b) => { b.entries[0].date = '2026-02-30'; }).ok, false);
  assert.equal(bad((b) => { b.entries[0].categoryId = 'nope'; }).ok, false);
  assert.equal(bad((b) => { b.budgets['2026-11'].food = 1.5; }).ok, false);
  assert.equal(bad((b) => { b.budgets['2026-13'] = {}; }).ok, false);
  assert.equal(bad((b) => { b.categories.push({ ...b.categories[0] }); }).ok, false); // duplicate id
  assert.equal(bad((b) => { b.categories[0].id = '<img src=x>'; }).ok, false);
  assert.equal(bad((b) => { b.schema = 99; }).ok, false); // from a newer app
});

test('imported text fields are trimmed to size and colours are checked', () => {
  const b = buildBackup(sample());
  b.entries[0].note = 'x'.repeat(5000);
  b.categories[0].color = 'red; background:url(x)';
  const r = parseBackup(JSON.stringify(b));
  assert.equal(r.data.entries[0].note.length, 200);
  assert.equal(r.data.categories[0].color, '#7C8796');
});

test('backup reminder after 14 days, only when there is data', () => {
  const now = Date.UTC(2026, 10, 24);
  assert.equal(needsBackupReminder(undefined, now, false), false);
  assert.equal(needsBackupReminder(undefined, now, true), true); // never exported
  assert.equal(needsBackupReminder(now - 14 * DAY, now, true), false);
  assert.equal(needsBackupReminder(now - 14 * DAY - 1, now, true), true);
  assert.equal(needsBackupReminder(now - 2 * DAY, now, true), false);
});
