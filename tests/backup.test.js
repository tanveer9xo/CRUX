import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBackup, parseBackup, needsBackupReminder } from '../js/backup.js';

const DAY = 86_400_000;
const sample = () => ({
  categories: [{ id: 'food', name: 'Groceries', emoji: '🛒', color: '#3DDC97', order: 0, archived: false, createdAt: 1 }],
  budgets: { '2026-11': { food: 800000 } },
  entries: [{ id: 'e1', amount: 25050, categoryId: 'food', date: '2026-11-24', note: 'veg', createdAt: 2, updatedAt: 2 }],
  goals: [{
    id: 'g1', name: 'Emergency fund', emoji: '🛟', target: 5000000, targetDate: '2027-12-31', monthlyPlan: 200000,
    buckets: [{ id: 'b1', name: 'Savings account' }, { id: 'b2', name: 'FD' }], archived: false, order: 0, createdAt: 3,
  }, { id: 'g2', name: 'Long-term investments', emoji: '📈', target: 0, targetDate: null, monthlyPlan: 0, buckets: [], archived: true, order: 1, createdAt: 4 }],
  goalAdds: [
    { id: 'a1', goalId: 'g1', amount: 300000, date: '2026-11-02', note: 'bonus', bucketId: 'b2', createdAt: 5 },
    { id: 'a2', goalId: 'g1', amount: -50000, date: '2026-11-10', note: 'repair', bucketId: 'b1', createdAt: 6 },
    { id: 'a3', goalId: 'g2', amount: 100000, date: '2026-11-12', note: '', bucketId: null, createdAt: 7 },
  ],
  bills: [{
    id: 'bill1', name: 'Bike EMI', type: 'emi', amount: 350000, recurrence: 'monthly', dueDate: '2026-12-05', anchorDay: 5, warnDays: 3,
    endDate: null, installmentsLeft: 7, note: '', categoryId: 'food', logExpense: true, lastDay: false, archived: false, archivedReason: null, createdAt: 8,
  }, {
    id: 'bill2', name: 'Card', type: 'cc', amount: null, recurrence: 'monthly', dueDate: '2026-11-30', anchorDay: 31, lastDay: true, warnDays: 5,
    endDate: '2027-12-31', installmentsLeft: null, note: 'HDFC', categoryId: null, logExpense: false, archived: false, archivedReason: null, createdAt: 9,
  }],
});

const bad = (mutate) => {
  const b = buildBackup(sample());
  mutate(b);
  return parseBackup(JSON.stringify(b));
};

test('a backup round-trips exactly, goals and bills included', () => {
  const file = JSON.stringify(buildBackup(sample(), new Date('2026-11-24T10:00:00Z')));
  const r = parseBackup(file);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.data, sample());
  assert.equal(r.hasGoalData, true);
  assert.deepEqual(r.counts, { categories: 1, entries: 1, months: 1, goals: 2, goalAdds: 3, bills: 2 });
  assert.equal(r.exportedAt, '2026-11-24T10:00:00.000Z');
  assert.equal(JSON.parse(file).schema, 2);
});

test('negative goal adds (withdrawals) and a null amount on a bill survive the round trip', () => {
  const r = parseBackup(JSON.stringify(buildBackup(sample())));
  assert.equal(r.data.goalAdds[1].amount, -50000);
  assert.equal(r.data.bills[1].amount, null);
});

test('a backup exported from 1.0.2 still imports cleanly (no goals or bills in it)', () => {
  const text = readFileSync(new URL('./fixtures/backup-1.0.2.json', import.meta.url), 'utf8');
  const r = parseBackup(text);
  assert.ok(r.ok, r.error);
  assert.equal(r.hasGoalData, false); // so the app keeps the goals and bills already on the device
  assert.deepEqual(r.counts, { categories: 3, entries: 3, months: 2, goals: 0, goalAdds: 0, bills: 0 });
  assert.deepEqual(r.data.goals, []);
  assert.equal(r.data.entries[0].amount, 125050);
  assert.equal(r.data.categories[2].archived, true);
});

test('imports are rejected whole when anything is wrong', () => {
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

test('damaged goals, goal adds and bills are rejected whole', () => {
  assert.equal(bad((b) => { delete b.goals; }).ok, false); // a schema-2 file must carry them
  assert.equal(bad((b) => { b.goals[0].target = 1.5; }).ok, false);
  assert.equal(bad((b) => { b.goals[0].target = -5; }).ok, false);
  assert.equal(bad((b) => { b.goals[0].targetDate = '2027-02-30'; }).ok, false);
  assert.equal(bad((b) => { b.goals[1].id = 'g1'; }).ok, false); // duplicate goal id
  assert.equal(bad((b) => { b.goals[0].buckets[1].id = 'b1'; }).ok, false); // duplicate bucket id
  assert.equal(bad((b) => { b.goalAdds[0].goalId = 'ghost'; }).ok, false);
  assert.equal(bad((b) => { b.goalAdds[0].amount = 0; }).ok, false);
  assert.equal(bad((b) => { b.goalAdds[0].amount = 10.5; }).ok, false);
  assert.equal(bad((b) => { b.goalAdds[0].date = 'yesterday'; }).ok, false);
  assert.equal(bad((b) => { b.goalAdds[0].bucketId = 'b9'; }).ok, false); // bucket not in that goal
  assert.equal(bad((b) => { b.goalAdds[2].bucketId = 'b1'; }).ok, false); // bucket of another goal
  assert.equal(bad((b) => { b.bills[0].type = 'loan'; }).ok, false);
  assert.equal(bad((b) => { b.bills[0].recurrence = 'weekly'; }).ok, false);
  assert.equal(bad((b) => { b.bills[0].dueDate = '2026-04-31'; }).ok, false);
  assert.equal(bad((b) => { b.bills[0].amount = -1; }).ok, false);
  assert.equal(bad((b) => { b.bills[0].installmentsLeft = -2; }).ok, false);
  assert.equal(bad((b) => { b.bills[0].installmentsLeft = 2.5; }).ok, false);
  assert.equal(bad((b) => { b.bills[0].warnDays = -1; }).ok, false);
  assert.equal(bad((b) => { b.bills[0].categoryId = 'ghost'; }).ok, false);
  assert.equal(bad((b) => { b.bills.push({ ...b.bills[0] }); }).ok, false); // duplicate bill id
});

test('a backup from a goals-aware build with nothing in them is fine', () => {
  const b = buildBackup({ ...sample(), goals: [], goalAdds: [], bills: [] });
  const r = parseBackup(JSON.stringify(b));
  assert.ok(r.ok);
  assert.deepEqual(r.counts, { categories: 1, entries: 1, months: 1, goals: 0, goalAdds: 0, bills: 0 });
});

test('imported text fields are trimmed to size and colours are checked', () => {
  const b = buildBackup(sample());
  b.entries[0].note = 'x'.repeat(5000);
  b.categories[0].color = 'red; background:url(x)';
  b.goalAdds[0].note = 'y'.repeat(5000);
  b.bills[0].name = 'z'.repeat(500);
  b.goals[0].name = 'w'.repeat(500);
  const r = parseBackup(JSON.stringify(b));
  assert.equal(r.data.entries[0].note.length, 200);
  assert.equal(r.data.goalAdds[0].note.length, 200);
  assert.equal(r.data.bills[0].name.length, 60);
  assert.equal(r.data.goals[0].name.length, 40);
  assert.equal(r.data.categories[0].color, '#7C8796');
});

test('a missing anchor day is rebuilt from the due date', () => {
  const b = buildBackup(sample());
  delete b.bills[0].anchorDay;
  assert.equal(parseBackup(JSON.stringify(b)).data.bills[0].anchorDay, 5);
});

test('backup reminder after 14 days, only when there is data', () => {
  const now = Date.UTC(2026, 10, 24);
  assert.equal(needsBackupReminder(undefined, now, false), false);
  assert.equal(needsBackupReminder(undefined, now, true), true); // never exported
  assert.equal(needsBackupReminder(now - 14 * DAY, now, true), false);
  assert.equal(needsBackupReminder(now - 14 * DAY - 1, now, true), true);
  assert.equal(needsBackupReminder(now - 2 * DAY, now, true), false);
});

test('“last day of month” survives the round trip; a file without it (1.1.0) means a fixed due day', () => {
  const r = parseBackup(JSON.stringify(buildBackup(sample())));
  assert.deepEqual(r.data.bills.map((b) => [b.lastDay, b.anchorDay]), [[false, 5], [true, 31]]);
  const old = buildBackup(sample());
  for (const b of old.bills) delete b.lastDay;
  const o = parseBackup(JSON.stringify(old));
  assert.ok(o.ok);
  assert.deepEqual(o.data.bills.map((b) => [b.lastDay, b.anchorDay]), [[false, 5], [false, 31]]);
});

test('a last-day bill always imports with anchor 31, whatever the file says', () => {
  const b = buildBackup(sample());
  b.bills[1].anchorDay = 12;
  assert.equal(parseBackup(JSON.stringify(b)).data.bills[1].anchorDay, 31);
});
