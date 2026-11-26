// App state: everything is loaded into memory at start (a personal tracker is small), and every change is
// written to IndexedDB before the state changes. Views read `state` and call these actions.
import * as db from './db.js';
import { todayYmd, monthOf } from './dates.js';
import { rollover, setBudget as setBudgetPure, budgetsFor } from './budget.js';
import { buildBackup } from './backup.js';
import { byNewest } from './insights.js';
import { SEED_CATEGORIES, SEED_BUDGET, COLORS, SEED_GOALS, withIcon } from './seed.js';
import { hasIcon } from './icons.js';
import { markPaid as billMarkPaid, skipOne as billSkipOne, sweepEnded } from './bills.js';
import { receiveIncome, skipSource as skipIncomeSource } from './income.js';
import { DEFAULT_PERIOD_SETTINGS, ensureCycles, confirmStart, editStart, buildCycles, movedEntries } from './cycles.js';
import { makePeriods, migrationSummary } from './periods.js';

export const state = {
  categories: [], // sorted by order
  budgets: {}, // { month: { categoryId: paise } }
  entries: [], // newest first
  goals: [], // sorted by order; archived ones included
  goalAdds: [], // newest first. A separate list from entries: never counted as spending
  bills: [], // archived ones included
  income: [], // newest first. Its own list: never an expense, never a goal add
  incomeSources: [], // recurring monthly income (e.g. Salary); archived ones included
  lastExport: undefined, // ms
  prefill: null, // set by "Mark paid" for the Add screen to pick up once
  periodSettings: { ...DEFAULT_PERIOD_SETTINGS }, // { mode: 'cycle' | 'month', nthLast, holidays, migrationPending }
  cycles: [], // stored pay-cycle starts [{ start, source }]
  cycleBudgets: {}, // pay-cycle budgets by cycle name; state.budgets keeps the calendar-month ones
};

export { COLORS };

export const uid = () => {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 16);
};

const sortCats = () => state.categories.sort((a, b) => a.order - b.order);
const sortEntries = () => state.entries.sort(byNewest);
const sortGoals = () => state.goals.sort((a, b) => a.order - b.order);
const sortAdds = () => state.goalAdds.sort(byNewest);
const sortIncome = () => state.income.sort(byNewest);
const upsert = (list, item) => [...list.filter((x) => x.id !== item.id), item];

export const catById = (id) => state.categories.find((c) => c.id === id);
export const activeCategories = () => state.categories.filter((c) => !c.archived);
export const currentMonth = () => monthOf(todayYmd());

export async function init() {
  const [categories, budgetRows, entries, goals, goalAdds, bills, income, incomeSources, cycles, cycleBudgetRows] = await Promise.all(['categories', 'budgets', 'entries', 'goals', 'goalAdds', 'bills', 'income', 'incomeSources', 'cycles', 'cycleBudgets'].map((s) => db.getAll(s)));
  state.cycles = cycles;
  state.cycleBudgets = Object.fromEntries(cycleBudgetRows.map((r) => [r.key, r.plan]));
  state.categories = categories;
  state.income = income;
  state.incomeSources = incomeSources;
  state.goals = goals;
  state.goalAdds = goalAdds;
  state.bills = bills;
  state.budgets = Object.fromEntries(budgetRows.map((r) => [r.month, r.plan]));
  state.entries = entries;
  state.lastExport = await db.getMeta('lastExport');
  sortCats();
  sortEntries();
  sortGoals();
  sortAdds();
  sortIncome();
  await migrateIcons();
  const fresh = !categories.length && !(await db.getMeta('seeded'));
  if (fresh) await seed();
  // Budget period: new installs start on pay cycles; an existing install stays on calendar months until it has seen
  // the one-time migration summary and chosen (Home and Settings offer it).
  const ps = await db.getMeta('periodSettings');
  if (ps) state.periodSettings = { ...DEFAULT_PERIOD_SETTINGS, ...ps };
  else {
    state.periodSettings = fresh ? { ...DEFAULT_PERIOD_SETTINGS } : { ...DEFAULT_PERIOD_SETTINGS, mode: 'month', migrationPending: true };
    await db.setMeta('periodSettings', state.periodSettings);
  }
  // Goals are seeded once per device, including on an upgrade from 1.0.x (which only adds them; nothing is removed).
  if (!(await db.getMeta('goalsSeeded'))) await seedGoals();
  await ensureCurrentMonth();
}

function starterGoals(now) {
  return SEED_GOALS.map(({ name, icon, emoji, color }, i) => ({ id: uid(), name, icon, emoji, color, target: 0, targetDate: null, monthlyPlan: 0, buckets: [], archived: false, order: i, createdAt: now }));
}

async function seedGoals() {
  const now = Date.now();
  const goals = starterGoals(now);
  await db.write([...goals.map((g) => ({ store: 'goals', put: g })), { store: 'meta', put: { key: 'goalsSeeded', value: now } }]);
  state.goals = goals;
}

/**
 * 1.3.0: categories and goals that only had an emoji get an icon key (by name; unmatched → "tag"), and goals a colour.
 * The emoji stays in each record, and existing colours are untouched. Idempotent: runs on every start, writes only
 * what changed, in one transaction.
 */
async function migrateIcons() {
  const cats = state.categories.map((c, i) => withIcon(c, { valid: hasIcon, index: i }));
  const goals = state.goals.map((g, i) => withIcon(g, { valid: hasIcon, index: i }));
  const ops = [
    ...cats.filter((c, i) => c !== state.categories[i]).map((c) => ({ store: 'categories', put: c })),
    ...goals.filter((g, i) => g !== state.goals[i]).map((g) => ({ store: 'goals', put: g })),
  ];
  if (!ops.length) return 0;
  await db.write(ops);
  state.categories = cats;
  state.goals = goals;
  return ops.length;
}

function starterData(month) {
  const now = Date.now();
  const cats = SEED_CATEGORIES.map(({ name, icon, emoji, color }, i) => ({ id: uid(), name, icon, emoji, color, order: i, archived: false, createdAt: now }));
  const plan = Object.fromEntries(cats.map((c) => [c.id, SEED_BUDGET]));
  return { now, cats, plan };
}

async function seed() {
  const month = currentMonth();
  const { now, cats, plan } = starterData(month);
  await db.write([...cats.map((c) => ({ store: 'categories', put: c })), { store: 'budgets', put: { month, plan } }, { store: 'meta', put: { key: 'seeded', value: now } }]);
  state.categories = cats;
  state.budgets = { [month]: plan };
}

/** Month rollover: give the current month its own copy of the plan, so later edits can't change the past. */
// ---- budget periods (calendar months or pay cycles) ----
export const cycleMode = () => state.periodSettings.mode === 'cycle' && state.cycles.length > 0;

/** The period API for today (js/periods.js): current(), prev(p), next(p), toDate(p), daysLeft(p), byKey(key)… */
export const periods = (today = todayYmd()) => makePeriods({ mode: cycleMode() ? 'cycle' : 'month', settings: state.periodSettings, records: state.cycles, today });
export const currentPeriod = () => periods().current();

const activeBudgets = () => (cycleMode() ? state.cycleBudgets : state.budgets);
const earliestDate = () => [...state.entries, ...state.income, ...state.goalAdds].reduce((m, x) => (x.date < m ? x.date : m), todayYmd());

async function saveCycles(records) {
  const keep = new Set(records.map((r) => r.start));
  const ops = [...state.cycles.filter((c) => !keep.has(c.start)).map((c) => ({ store: 'cycles', del: c.start })), ...records.map((r) => ({ store: 'cycles', put: r }))];
  if (ops.length) await db.write(ops);
  state.cycles = records;
}

/**
 * Rollover for the current period: in cycle mode, add the rule's cycles up to today (and back to the earliest data),
 * then give the current period its own copy of the budgets so later edits can't change the past.
 */
export async function ensureCurrentMonth() {
  if (state.periodSettings.mode === 'cycle') {
    const r = ensureCycles(state.cycles, state.periodSettings, todayYmd(), earliestDate());
    if (r.added.length) await saveCycles(r.records);
  }
  const key = currentPeriod().key;
  if (cycleMode()) {
    if (!Object.keys(state.cycleBudgets).length && Object.keys(state.budgets).length) await copyCalendarBudgets();
    const r = rollover(state.cycleBudgets, key);
    if (!r.created) return false;
    await db.put('cycleBudgets', { key, plan: r.budgets[key] });
    state.cycleBudgets = r.budgets;
    return true;
  }
  const r = rollover(state.budgets, key);
  if (!r.created) return false;
  await db.put('budgets', { month: key, plan: r.budgets[key] });
  state.budgets = r.budgets;
  return true;
}

/** The plan for a period key (a month, or a cycle's name month). */
export const planFor = (key) => budgetsFor(activeBudgets(), key);

/** "Salary received" / "Start new cycle now": the next cycle starts on `date` (confirmed). Returns an error or null. */
export async function startCycle(date) {
  const r = confirmStart(state.cycles, date, state.periodSettings);
  if (r.error) return r.error;
  await saveCycles(r.records);
  await ensureCurrentMonth();
  return null;
}

/** Preview of moving a cycle start: { error, moved: [{ entry, from, to }] } without changing anything. */
export function previewCycleEdit(from, to) {
  const r = editStart(state.cycles, from, to, state.periodSettings);
  if (r.error) return { error: r.error, moved: [] };
  return { error: null, moved: movedEntries(state.entries, buildCycles(state.cycles, state.periodSettings), buildCycles(r.records, state.periodSettings)) };
}

export async function editCycle(from, to) {
  const r = editStart(state.cycles, from, to, state.periodSettings);
  if (r.error) return r.error;
  await saveCycles(r.records);
  await ensureCurrentMonth();
  return null;
}

/** Change the rule (Nth-last working day, holidays). Past cycles keep their stored starts. */
export async function updatePeriodSettings(patch) {
  state.periodSettings = { ...state.periodSettings, ...patch };
  await db.setMeta('periodSettings', state.periodSettings);
  await ensureCurrentMonth();
}

/** What switching to pay cycles would do (shown before it is applied). */
export const cycleMigrationPreview = () => migrationSummary({ budgets: state.budgets, entries: state.entries, income: state.income, goalAdds: state.goalAdds, settings: state.periodSettings, today: todayYmd() });

/**
 * Switch to pay cycles. The first time: create cycles from the earliest data by the rule and copy each calendar
 * month's budgets onto the cycle of the same name (the calendar budgets stay in "budgets", so switching back restores
 * them). Later switches reuse the stored cycles and cycle budgets.
 */
export async function useCycles() {
  if (!state.cycles.length) {
    const r = ensureCycles([], state.periodSettings, todayYmd(), earliestDate());
    await saveCycles(r.records);
  }
  if (!Object.keys(state.cycleBudgets).length) await copyCalendarBudgets();
  await updatePeriodSettings({ mode: 'cycle', migrationPending: false });
}

/** Each calendar month's budgets onto the cycle with the same name; later cycles carry the last one forward. */
async function copyCalendarBudgets() {
  const copy = Object.fromEntries(Object.entries(state.budgets).map(([k, plan]) => [k, { ...plan }]));
  if (Object.keys(copy).length) await db.write(Object.entries(copy).map(([key, plan]) => ({ store: 'cycleBudgets', put: { key, plan } })));
  state.cycleBudgets = copy;
}

/** Switch to calendar months: today's behaviour exactly, with the calendar-month budgets as they were. */
export const useCalendarMonths = () => updatePeriodSettings({ mode: 'month', migrationPending: false });

// ---- entries ----
export async function saveEntry({ id, amount, categoryId, date, note }) {
  const now = Date.now();
  const old = id ? state.entries.find((e) => e.id === id) : null;
  const entry = { id: old?.id ?? uid(), amount, categoryId, date, note: (note ?? '').trim().slice(0, 200), createdAt: old?.createdAt ?? now, updatedAt: now };
  await db.put('entries', entry);
  state.entries = [...state.entries.filter((e) => e.id !== entry.id), entry];
  sortEntries();
  return entry;
}

export async function deleteEntry(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return null;
  await db.write([{ store: 'entries', del: id }]);
  state.entries = state.entries.filter((e) => e.id !== id);
  return entry;
}

export async function restoreEntry(entry) {
  await db.put('entries', entry);
  state.entries = [...state.entries.filter((e) => e.id !== entry.id), entry];
  sortEntries();
}

// ---- plan ----
async function commitBudgets(next, changedFrom) {
  const cyc = cycleMode();
  const ops = Object.keys(next).filter((m) => m >= changedFrom).map((k) => (cyc ? { store: 'cycleBudgets', put: { key: k, plan: next[k] } } : { store: 'budgets', put: { month: k, plan: next[k] } }));
  await db.write(ops);
  if (cyc) state.cycleBudgets = next;
  else state.budgets = next;
}

/** Set a category's budget from this period (month or cycle) onward; earlier periods keep theirs. */
export const setBudget = (key, categoryId, paise) => commitBudgets(setBudgetPure(activeBudgets(), key, categoryId, paise), key);

export async function addCategory({ name, icon, color, budget }, month) {
  const cat = { id: uid(), name, icon: icon ?? 'tag', emoji: '', color, order: Math.max(-1, ...state.categories.map((c) => c.order)) + 1, archived: false, createdAt: Date.now() };
  await db.put('categories', cat);
  state.categories.push(cat);
  sortCats();
  await setBudget(month, cat.id, budget);
  return cat;
}

export async function updateCategory(id, patch) {
  const cat = { ...catById(id), ...patch };
  await db.put('categories', cat);
  state.categories = state.categories.map((c) => (c.id === id ? cat : c));
  sortCats();
}

/** Swap a category with its neighbour among active categories. dir: -1 up, +1 down. */
export async function moveCategory(id, dir) {
  const list = activeCategories();
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = { ...list[i], order: list[j].order };
  const b = { ...list[j], order: list[i].order };
  if (a.order === b.order) b.order += dir; // repair duplicate orders
  await db.write([{ store: 'categories', put: a }, { store: 'categories', put: b }]);
  state.categories = state.categories.map((c) => (c.id === a.id ? a : c.id === b.id ? b : c));
  sortCats();
}

/** Archive: leaves the plan from `month` onward; past months and its entries stay as they were. */
export async function archiveCategory(id, month) {
  await setBudget(month, id, null);
  await updateCategory(id, { archived: true });
}

/** Bring an archived category back into the plan from `month`, with its last known budget. */
export async function restoreCategory(id, month) {
  const map = activeBudgets();
  const months = Object.keys(map).sort().reverse();
  const last = months.map((m) => map[m][id]).find((v) => v !== undefined) ?? 0;
  await updateCategory(id, { archived: false, order: Math.max(...state.categories.map((c) => c.order)) + 1 });
  await setBudget(month, id, last);
}

// ---- goals ----
export const goalById = (id) => state.goals.find((g) => g.id === id);
export const activeGoals = () => state.goals.filter((g) => !g.archived);

export async function saveGoal(goal) {
  const g = { ...goal, id: goal.id ?? uid(), order: goal.order ?? Math.max(-1, ...state.goals.map((x) => x.order)) + 1, createdAt: goal.createdAt ?? Date.now() };
  await db.put('goals', g);
  state.goals = upsert(state.goals, g);
  sortGoals();
  return g;
}

export async function saveGoalAdd(add) {
  const a = { ...add, id: add.id ?? uid(), createdAt: add.createdAt ?? Date.now() };
  await db.put('goalAdds', a);
  state.goalAdds = upsert(state.goalAdds, a);
  sortAdds();
  return a;
}

export async function deleteGoalAdd(id) {
  const a = state.goalAdds.find((x) => x.id === id);
  if (!a) return null;
  await db.write([{ store: 'goalAdds', del: id }]);
  state.goalAdds = state.goalAdds.filter((x) => x.id !== id);
  return a;
}

export async function restoreGoalAdd(a) {
  await db.put('goalAdds', a);
  state.goalAdds = upsert(state.goalAdds, a);
  sortAdds();
}

/** Goal priority is the order goals are listed in. Swap with the neighbour among active goals (dir -1 up, +1 down). */
export async function moveGoal(id, dir) {
  const list = state.goals.filter((g) => !g.archived).sort((a, b) => a.order - b.order);
  const i = list.findIndex((g) => g.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = { ...list[i], order: list[j].order };
  const b = { ...list[j], order: list[i].order };
  if (a.order === b.order) b.order += dir; // repair duplicate orders
  await db.write([{ store: 'goals', put: a }, { store: 'goals', put: b }]);
  state.goals = state.goals.map((g) => (g.id === a.id ? a : g.id === b.id ? b : g));
  sortGoals();
}

/** Several goal adds in one transaction (the allocate sheet): all are saved or none. */
export async function saveGoalAdds(adds) {
  const now = Date.now();
  const rows = adds.map((a, i) => ({ ...a, id: a.id ?? uid(), createdAt: a.createdAt ?? now + i }));
  await db.write(rows.map((a) => ({ store: 'goalAdds', put: a })));
  for (const a of rows) state.goalAdds = upsert(state.goalAdds, a);
  sortAdds();
  return rows;
}

export async function deleteGoalAdds(ids) {
  await db.write(ids.map((id) => ({ store: 'goalAdds', del: id })));
  state.goalAdds = state.goalAdds.filter((a) => !ids.includes(a.id));
}

// ---- income ----
export const sourceById = (id) => state.incomeSources.find((s) => s.id === id);

export async function saveIncome(entry) {
  const e = { ...entry, id: entry.id ?? uid(), sourceId: entry.sourceId ?? null, createdAt: entry.createdAt ?? Date.now() };
  await db.put('income', e);
  state.income = upsert(state.income, e);
  sortIncome();
  return e;
}

export async function deleteIncome(id) {
  const e = state.income.find((x) => x.id === id);
  if (!e) return null;
  await db.write([{ store: 'income', del: id }]);
  state.income = state.income.filter((x) => x.id !== id);
  return e;
}

export async function restoreIncome(e) {
  await db.put('income', e);
  state.income = upsert(state.income, e);
  sortIncome();
}

export async function saveSource(src) {
  const s = { ...src, id: src.id ?? uid(), createdAt: src.createdAt ?? Date.now() };
  await db.put('incomeSources', s);
  state.incomeSources = upsert(state.incomeSources, s);
  return s;
}

/** Confirm a recurring income received (see income.js): logs the entry and moves the source on, in one transaction. */
export async function receiveSource(id, { amount, date } = {}) {
  const before = sourceById(id);
  const r = receiveIncome(before, { today: date ?? todayYmd(), amount });
  // In pay-cycle mode a salary is expected on the next cycle's start, not on a fixed day of the month.
  if (before.startsCycle && cycleMode()) r.source.nextDate = periods().next(periods().current()).from;
  const entry = { ...r.entry, id: uid(), createdAt: Date.now() };
  await db.write([{ store: 'incomeSources', put: r.source }, { store: 'income', put: entry }]);
  state.incomeSources = upsert(state.incomeSources, r.source);
  state.income = upsert(state.income, entry);
  sortIncome();
  return { before, after: r.source, entry };
}

/** Undo a confirmation: the source goes back to how it was and the entry is removed. */
export async function undoReceive({ before, entry }) {
  await db.write([{ store: 'incomeSources', put: before }, { store: 'income', del: entry.id }]);
  state.incomeSources = upsert(state.incomeSources, before);
  state.income = state.income.filter((x) => x.id !== entry.id);
}

export async function skipSource(id) {
  const before = sourceById(id);
  const after = skipIncomeSource(before);
  await saveSource(after);
  return { before, after };
}

// ---- bills ----
export const billById = (id) => state.bills.find((b) => b.id === id);

export async function saveBill(bill) {
  const b = { ...bill, id: bill.id ?? uid(), createdAt: bill.createdAt ?? Date.now() };
  await db.put('bills', b);
  state.bills = upsert(state.bills, b);
  return b;
}

/** Mark paid (see bills.js): returns { before, after, expense, archivedReason }; `before` is what Undo restores. */
export async function markBillPaid(id) {
  const before = billById(id);
  const r = billMarkPaid(before);
  await saveBill(r.bill);
  return { before, after: r.bill, expense: r.expense, archivedReason: r.archivedReason };
}

export async function skipBill(id) {
  const before = billById(id);
  const r = billSkipOne(before);
  await saveBill(r.bill);
  return { before, after: r.bill, archivedReason: r.archivedReason };
}

export const restoreBill = (before) => saveBill(before);

/** Archive bills that have run out (no instalments left, or past their end date). Returns [{ before, after }] for Undo. */
export async function sweepEndedBills() {
  const swept = sweepEnded(state.bills);
  if (!swept.length) return [];
  await db.write(swept.map((s) => ({ store: 'bills', put: s.after })));
  for (const s of swept) state.bills = upsert(state.bills, s.after);
  return swept;
}

export async function restoreBills(swept) {
  await db.write(swept.map((s) => ({ store: 'bills', put: s.before })));
  for (const s of swept) state.bills = upsert(state.bills, s.before);
}

// ---- backup ----
export function exportData(now = new Date()) {
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt);
  return buildBackup({
    categories: state.categories,
    budgets: state.budgets,
    entries: [...state.entries].sort(byDate),
    goals: state.goals,
    goalAdds: [...state.goalAdds].sort(byDate),
    bills: state.bills,
    income: [...state.income].sort(byDate),
    incomeSources: state.incomeSources,
    periodSettings: { mode: state.periodSettings.mode, nthLast: state.periodSettings.nthLast, holidays: state.periodSettings.holidays },
    cycles: state.cycles,
    cycleBudgets: state.cycleBudgets,
  }, now);
}

export async function markExported(ms = Date.now()) {
  await db.setMeta('lastExport', ms);
  state.lastExport = ms;
}

/**
 * Replace everything with validated backup data (from parseBackup). A backup from 1.0.x has no goals or bills
 * (`keepGoalData`): the goals, goal adds and bills on this device are then left exactly as they are.
 */
export async function importData(data, { keepGoalData = false, keepIncomeData = false } = {}) {
  // Kept bills may link to a category the imported file doesn't have: unlink those, so the next export stays valid.
  const catIds = new Set(data.categories.map((c) => c.id));
  const relinked = keepGoalData ? state.bills.filter((b) => b.categoryId && !catIds.has(b.categoryId)).map((b) => ({ ...b, categoryId: null })) : [];
  await db.replaceAll(keepGoalData ? { ...data, bills: relinked } : data, { seeded: Date.now(), goalsSeeded: Date.now() }, { keepGoalData, keepIncomeData });
  for (const b of relinked) state.bills = upsert(state.bills, b);
  state.categories = [...data.categories];
  state.budgets = { ...data.budgets };
  state.entries = [...data.entries];
  if (!keepGoalData) {
    state.goals = [...data.goals];
    state.goalAdds = [...data.goalAdds];
    state.bills = [...data.bills];
  }
  if (!keepIncomeData) {
    state.income = [...data.income];
    state.incomeSources = [...data.incomeSources];
  }
  // Cycles come with the file (none in an older backup, which then opens in calendar-month mode).
  state.cycles = [...(data.cycles ?? [])];
  state.cycleBudgets = { ...(data.cycleBudgets ?? {}) };
  state.periodSettings = { ...DEFAULT_PERIOD_SETTINGS, ...(data.periodSettings ?? { mode: 'month' }), migrationPending: false };
  await db.setMeta('periodSettings', state.periodSettings);
  sortCats();
  sortEntries();
  sortGoals();
  sortAdds();
  sortIncome();
  await ensureCurrentMonth();
}

/** Remove CRUX's own localStorage keys (names starting "crux") and nothing else: VANE shares this origin. */
function clearCruxLocalStorage() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('crux') && k !== 'crux-theme') localStorage.removeItem(k); // keeps the chosen theme
  } catch { /* storage blocked */ }
}

/**
 * Wipe CRUX's data (expenses, budgets, categories, goals, goal adds, bills, income and recurring income) and put the starter categories and
 * goals back (₹0 budgets and targets, nothing logged), in one transaction on the "crux" database. Also removes
 * crux-prefixed localStorage keys. Never touches other databases, keys or caches.
 */
export async function resetToStarter() {
  const month = currentMonth();
  const { now, cats, plan } = starterData(month);
  const goals = starterGoals(now);
  const appLock = await db.getMeta('appLock'); // a device setting, not data: the lock stays on after a reset
  const periodSettings = { ...state.periodSettings, migrationPending: false }; // also a preference: kept
  await db.replaceAll({ categories: cats, budgets: { [month]: plan }, entries: [], goals, goalAdds: [], bills: [], income: [], incomeSources: [] }, { seeded: now, goalsSeeded: now, periodSettings, ...(appLock ? { appLock } : {}) }, { clearMeta: true });
  clearCruxLocalStorage();
  state.categories = cats;
  state.budgets = { [month]: plan };
  state.entries = [];
  state.goals = goals;
  state.goalAdds = [];
  state.bills = [];
  state.income = [];
  state.incomeSources = [];
  state.cycles = [];
  state.cycleBudgets = {};
  state.periodSettings = periodSettings;
  state.lastExport = undefined;
  await ensureCurrentMonth(); // fresh cycles from today (in cycle mode) and the current period's budgets
}

export async function eraseAll() {
  await db.replaceAll({ categories: [], budgets: {}, entries: [], goals: [], goalAdds: [], bills: [], income: [], incomeSources: [] }, { seeded: Date.now(), goalsSeeded: Date.now(), lastExport: null, appLock: null, lockFails: null });
  state.categories = [];
  state.budgets = {};
  state.entries = [];
  state.goals = [];
  state.goalAdds = [];
  state.bills = [];
  state.income = [];
  state.incomeSources = [];
  state.cycles = [];
  state.cycleBudgets = {};
  state.lastExport = null;
}
