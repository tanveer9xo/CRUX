// App state: everything is loaded into memory at start (a personal tracker is small), and every change is
// written to IndexedDB before the state changes. Views read `state` and call these actions.
import * as db from './db.js';
import { todayYmd, monthOf } from './dates.js';
import { rollover, setBudget as setBudgetPure, budgetsFor } from './budget.js';
import { buildBackup } from './backup.js';
import { byNewest } from './insights.js';
import { SEED_CATEGORIES, SEED_BUDGET, COLORS, SEED_GOALS } from './seed.js';
import { markPaid as billMarkPaid, skipOne as billSkipOne, sweepEnded } from './bills.js';

export const state = {
  categories: [], // sorted by order
  budgets: {}, // { month: { categoryId: paise } }
  entries: [], // newest first
  goals: [], // sorted by order; archived ones included
  goalAdds: [], // newest first. A separate list from entries: never counted as spending
  bills: [], // archived ones included
  lastExport: undefined, // ms
  prefill: null, // set by "Mark paid" for the Add screen to pick up once
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
const upsert = (list, item) => [...list.filter((x) => x.id !== item.id), item];

export const catById = (id) => state.categories.find((c) => c.id === id);
export const activeCategories = () => state.categories.filter((c) => !c.archived);
export const currentMonth = () => monthOf(todayYmd());

export async function init() {
  const [categories, budgetRows, entries, goals, goalAdds, bills] = await Promise.all(['categories', 'budgets', 'entries', 'goals', 'goalAdds', 'bills'].map((s) => db.getAll(s)));
  state.categories = categories;
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
  if (!categories.length && !(await db.getMeta('seeded'))) await seed();
  // Goals are seeded once per device, including on an upgrade from 1.0.x (which only adds them; nothing is removed).
  if (!(await db.getMeta('goalsSeeded'))) await seedGoals();
  await ensureCurrentMonth();
}

function starterGoals(now) {
  return SEED_GOALS.map(({ name, emoji }, i) => ({ id: uid(), name, emoji, target: 0, targetDate: null, monthlyPlan: 0, buckets: [], archived: false, order: i, createdAt: now }));
}

async function seedGoals() {
  const now = Date.now();
  const goals = starterGoals(now);
  await db.write([...goals.map((g) => ({ store: 'goals', put: g })), { store: 'meta', put: { key: 'goalsSeeded', value: now } }]);
  state.goals = goals;
}

function starterData(month) {
  const now = Date.now();
  const cats = SEED_CATEGORIES.map(({ name, emoji, color }, i) => ({ id: uid(), name, emoji, color, order: i, archived: false, createdAt: now }));
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
export async function ensureCurrentMonth() {
  const month = currentMonth();
  const r = rollover(state.budgets, month);
  if (!r.created) return false;
  await db.put('budgets', { month, plan: r.budgets[month] });
  state.budgets = r.budgets;
  return true;
}

export const planFor = (month) => budgetsFor(state.budgets, month);

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
  const ops = Object.keys(next).filter((m) => m >= changedFrom).map((month) => ({ store: 'budgets', put: { month, plan: next[month] } }));
  await db.write(ops);
  state.budgets = next;
}

/** Set a category's budget from `month` onward; earlier months keep theirs. */
export const setBudget = (month, categoryId, paise) => commitBudgets(setBudgetPure(state.budgets, month, categoryId, paise), month);

export async function addCategory({ name, emoji, color, budget }, month) {
  const cat = { id: uid(), name, emoji, color, order: Math.max(-1, ...state.categories.map((c) => c.order)) + 1, archived: false, createdAt: Date.now() };
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
  const months = Object.keys(state.budgets).sort().reverse();
  const last = months.map((m) => state.budgets[m][id]).find((v) => v !== undefined) ?? 0;
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
export async function importData(data, { keepGoalData = false } = {}) {
  // Kept bills may link to a category the imported file doesn't have: unlink those, so the next export stays valid.
  const catIds = new Set(data.categories.map((c) => c.id));
  const relinked = keepGoalData ? state.bills.filter((b) => b.categoryId && !catIds.has(b.categoryId)).map((b) => ({ ...b, categoryId: null })) : [];
  await db.replaceAll(keepGoalData ? { ...data, bills: relinked } : data, { seeded: Date.now(), goalsSeeded: Date.now() }, { keepGoalData });
  for (const b of relinked) state.bills = upsert(state.bills, b);
  state.categories = [...data.categories];
  state.budgets = { ...data.budgets };
  state.entries = [...data.entries];
  if (!keepGoalData) {
    state.goals = [...data.goals];
    state.goalAdds = [...data.goalAdds];
    state.bills = [...data.bills];
  }
  sortCats();
  sortEntries();
  sortGoals();
  sortAdds();
  await ensureCurrentMonth();
}

/** Remove CRUX's own localStorage keys (names starting "crux") and nothing else: VANE shares this origin. */
function clearCruxLocalStorage() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('crux')) localStorage.removeItem(k);
  } catch { /* storage blocked */ }
}

/**
 * Wipe CRUX's data (expenses, budgets, categories, goals, goal adds and bills) and put the starter categories and
 * goals back (₹0 budgets and targets, nothing logged), in one transaction on the "crux" database. Also removes
 * crux-prefixed localStorage keys. Never touches other databases, keys or caches.
 */
export async function resetToStarter() {
  const month = currentMonth();
  const { now, cats, plan } = starterData(month);
  const goals = starterGoals(now);
  await db.replaceAll({ categories: cats, budgets: { [month]: plan }, entries: [], goals, goalAdds: [], bills: [] }, { seeded: now, goalsSeeded: now }, { clearMeta: true });
  clearCruxLocalStorage();
  state.categories = cats;
  state.budgets = { [month]: plan };
  state.entries = [];
  state.goals = goals;
  state.goalAdds = [];
  state.bills = [];
  state.lastExport = undefined;
}

export async function eraseAll() {
  await db.replaceAll({ categories: [], budgets: {}, entries: [], goals: [], goalAdds: [], bills: [] }, { seeded: Date.now(), goalsSeeded: Date.now(), lastExport: null });
  state.categories = [];
  state.budgets = {};
  state.entries = [];
  state.goals = [];
  state.goalAdds = [];
  state.bills = [];
  state.lastExport = null;
}
