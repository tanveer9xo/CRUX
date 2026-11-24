// Quick add / edit. Three taps: + (opens with the amount field focused), a category chip, Save.
import { h, icon, toast, confirmDialog } from '../ui.js';
import { parseAmount, paiseToInput, formatINR } from '../money.js';
import { todayYmd, addDays, isYmd } from '../dates.js';
import { state, saveEntry, deleteEntry, restoreEntry, activeCategories, catById } from '../store.js';
import { go, goBack, refresh } from '../router.js';
import { requestPersistence } from '../pwa.js';
import { emptyState } from './common.js';

export const name = 'add';
export const tab = 'add';
export const isEditor = true;
export let title = 'Add';

export function render({ params }) {
  const editing = params.id ? state.entries.find((e) => e.id === params.id) : null;
  title = editing ? 'Edit' : 'Add';
  if (params.id && !editing) {
    return h('div', { class: 'page' }, emptyState('This expense no longer exists', null, h('a', { class: 'btn', href: '#/' }, 'Home')));
  }

  const cats = activeCategories();
  if (editing && !cats.some((c) => c.id === editing.categoryId) && catById(editing.categoryId)) cats.push(catById(editing.categoryId));
  if (!cats.length) {
    return h('div', { class: 'page' }, emptyState('No categories', 'Add a category in Plan first.', h('a', { class: 'btn', href: '#/plan' }, 'Open Plan')));
  }

  let selected = editing?.categoryId ?? null;
  const today = todayYmd();
  const err = h('p', { class: 'form-error', role: 'alert' });

  const amount = h('input', {
    id: 'amount', class: 'amount-input num', type: 'text', inputmode: 'decimal', enterkeyhint: 'done',
    autocomplete: 'off', placeholder: '0', 'aria-label': 'Amount in rupees', 'aria-describedby': 'amount-err',
    value: editing ? paiseToInput(editing.amount) : '',
    oninput: () => { amount.value = amount.value.replace(/[^\d.,]/g, ''); err.textContent = ''; },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } },
  });
  err.id = 'amount-err';

  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Category' },
    cats.map((c) => h('button', {
      class: 'chip', type: 'button', role: 'radio', 'aria-checked': String(c.id === selected), dataset: { id: c.id },
      style: { '--c': c.color },
      onclick: (e) => {
        selected = c.id;
        err.textContent = '';
        chips.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
      },
    }, h('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, c.emoji || '•'), h('span', {}, c.name))));

  const date = h('input', { id: 'date', type: 'date', class: 'input', value: editing?.date ?? today, required: true, onchange: () => syncDay() });
  const dayBtns = [['Today', today], ['Yesterday', addDays(today, -1)]].map(([label, d]) =>
    h('button', { class: 'chip chip-small', type: 'button', 'aria-pressed': 'false', onclick: () => { date.value = d; syncDay(); } }, label));
  const syncDay = () => dayBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(date.value === [today, addDays(today, -1)][i])));
  syncDay();

  const note = h('input', { id: 'note', type: 'text', class: 'input', maxlength: '200', placeholder: 'Note (optional)', value: editing?.note ?? '', enterkeyhint: 'done', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } } });

  let saving = false;
  async function save() {
    if (saving) return;
    const paise = parseAmount(amount.value);
    if (!paise) { err.textContent = 'Enter an amount above ₹0.'; amount.focus(); return; }
    if (!selected) { err.textContent = 'Pick a category.'; return; }
    if (!isYmd(date.value)) { err.textContent = 'Pick a date.'; return; }
    saving = true;
    try {
      const entry = await saveEntry({ id: editing?.id, amount: paise, categoryId: selected, date: date.value, note: note.value });
      if (state.entries.length === 1) requestPersistence();
      goBack();
      toast(`${editing ? 'Updated' : 'Saved'} ${formatINR(entry.amount)} · ${catById(entry.categoryId)?.name}`);
    } catch (e) {
      saving = false;
      err.textContent = `Couldn’t save: ${e.message}`;
    }
  }

  async function remove() {
    const ok = await confirmDialog({ title: 'Delete this expense?', body: `${formatINR(editing.amount)} · ${catById(editing.categoryId)?.name ?? ''}`, ok: 'Delete', danger: true });
    if (!ok) return;
    const gone = await deleteEntry(editing.id);
    goBack();
    toast(`Deleted ${formatINR(gone.amount)}`, { action: 'Undo', onAction: async () => { await restoreEntry(gone); refresh(); toast('Restored'); } });
  }

  return h('div', { class: 'page add' },
    h('header', { class: 'page-head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cancel', onclick: goBack }, icon('x')),
      h('h1', {}, editing ? 'Edit expense' : 'Add expense'),
      editing ? h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Delete expense', onclick: remove }, icon('trash')) : h('span', { class: 'icon-btn-spacer' })),
    h('form', { class: 'add-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      h('label', { class: 'amount-wrap', for: 'amount' }, h('span', { class: 'rupee', 'aria-hidden': 'true' }, '₹'), amount),
      err,
      chips,
      h('div', { class: 'field-row' }, h('label', { class: 'sr-only', for: 'date' }, 'Date'), date, ...dayBtns),
      h('label', { class: 'sr-only', for: 'note' }, 'Note'), note,
      h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, icon('check'), editing ? 'Save changes' : 'Save')));
}

/** Focus the amount right away (same tap as the + button, so iOS opens the number keyboard). */
export function after(main, r) {
  if (r.params.id) return;
  main.querySelector('#amount')?.focus();
}
