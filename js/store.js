// App state: everything is loaded into memory at start (a personal tracker is small), and every change is
// written to IndexedDB before the state changes. Views read `state` and call these actions.
import * as db from './db.js';
import { todayYmd, monthOf } from './dates.js';
import { rollover, setBudget as setBudgetPure, budgetsFor } from './budget.js';
import { buildBackup } from './backup.js';
import { byNewest } from './insights.js';
import { SEED_CATEGORIES, SEED_BUDGET, COLORS } from './seed.js';

export const state = {
  categories: [], // sorted by order
  budgets: {}, // { month: { categoryId: paise } }
  entries: [], // newest first
  lastExport: undefined, // ms
};

export { COLORS };

export const uid = () => {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 16);
};

const sortCats = () => state.categories.sort((a, b) => a.order - b.order);
const sortEntries = () => state.entries.sort(byNewest);

export const catById = (id) => state.categories.find((c) => c.id === id);
export const activeCategories = () => state.categories.filter((c) => !c.archived);
export const currentMonth = () => monthOf(todayYmd());

export async function init() {
  const [categories, budgetRows, entries] = await Promise.all([db.getAll('categories'), db.getAll('budgets'), db.getAll('entries')]);
  state.categories = categories;
  state.budgets = Object.fromEntries(budgetRows.map((r) => [r.month, r.plan]));
  state.entries = entries;
  state.lastExport = await db.getMeta('lastExport');
  sortCats();
  sortEntries();
  if (!categories.length && !(await db.getMeta('seeded'))) await seed();
  await ensureCurrentMonth();
}

async function seed() {
  const now = Date.now();
  const month = currentMonth();
  const cats = SEED_CATEGORIES.map(({ name, emoji, color }, i) => ({ id: uid(), name, emoji, color, order: i, archived: false, createdAt: now }));
  const plan = Object.fromEntries(cats.map((c) => [c.id, SEED_BUDGET]));
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

// ---- backup ----
export function exportData(now = new Date()) {
  return buildBackup({ categories: state.categories, budgets: state.budgets, entries: [...state.entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt)) }, now);
}

export async function markExported(ms = Date.now()) {
  await db.setMeta('lastExport', ms);
  state.lastExport = ms;
}

/** Replace everything with validated backup data (from parseBackup). */
export async function importData(data) {
  await db.replaceAll(data, { seeded: Date.now() });
  state.categories = [...data.categories];
  state.budgets = { ...data.budgets };
  state.entries = [...data.entries];
  sortCats();
  sortEntries();
  await ensureCurrentMonth();
}

export async function eraseAll() {
  await db.replaceAll({ categories: [], budgets: {}, entries: [] }, { seeded: Date.now(), lastExport: null });
  state.categories = [];
  state.budgets = {};
  state.entries = [];
  state.lastExport = null;
}
