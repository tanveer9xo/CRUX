// Plan: categories and their monthly budgets. Edits apply from the month shown onward; earlier months keep theirs.
import { h, icon, badge, sheet, toast, confirmDialog } from '../ui.js';
import { parseAmount, paiseToInput, formatINR } from '../money.js';
import { monthLabel, isMonth } from '../dates.js';
import { totalBudget } from '../budget.js';
import {
  state, planFor, currentMonth, activeCategories, setBudget, addCategory, updateCategory, moveCategory,
  archiveCategory, restoreCategory, COLORS, catById,
} from '../store.js';
import { refresh, setQuery, go } from '../router.js';
import { monthNav, pageHead } from './common.js';

export const name = 'plan';
export const tab = null;
export const title = 'Plan';

export function render({ query }) {
  const month = isMonth(query.get('m')) ? query.get('m') : currentMonth();
  const plan = planFor(month);
  const active = activeCategories();
  const planned = active.filter((c) => c.id in plan);
  const unplanned = active.filter((c) => !(c.id in plan));
  const archived = state.categories.filter((c) => c.archived);
  const totalEl = h('span', { class: 'num' }, formatINR(totalBudget(plan)));
  const past = month < currentMonth();

  return h('div', { class: 'page plan' },
    pageHead('Plan'),
    monthNav(month, (m) => setQuery({ m: m === currentMonth() ? null : m })),
    h('p', { class: `note ${past ? 'note-warn' : ''}` },
      past ? `You’re editing a past month. Changes apply to ${monthLabel(month)} and every month after it.`
        : `Changes apply from ${monthLabel(month)} onward. Earlier months keep their budgets.`),
    h('section', { class: 'card plan-total' }, h('span', { class: 'muted' }, 'Monthly budget'), h('strong', { class: 'plan-total-amt' }, totalEl)),

    h('ul', { class: 'plan-list' }, planned.map((c, i) => planRow(c, plan[c.id], month, i, planned.length, () => {
      totalEl.textContent = formatINR(totalBudget(planFor(month)));
    }))),
    h('button', { class: 'btn btn-wide', type: 'button', onclick: () => editSheet(null, month) }, icon('plus'), 'Add category'),

    unplanned.length ? h('section', {},
      h('h2', {}, `Not in the ${monthLabel(month)} plan`),
      h('ul', { class: 'plain-list' }, unplanned.map((c) => h('li', { class: 'plain-row' }, badge(c), h('span', { class: 'grow' }, c.name),
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => { await setBudget(month, c.id, 0); refresh(); } }, 'Add to plan'))))) : null,

    archived.length ? h('details', { class: 'archived' },
      h('summary', {}, `Archived (${archived.length})`),
      h('ul', { class: 'plain-list' }, archived.map((c) => h('li', { class: 'plain-row' }, badge(c), h('span', { class: 'grow' }, c.name),
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => { await restoreCategory(c.id, month); refresh(); toast(`${c.name} is back from ${monthLabel(month)}`); } }, 'Restore'))))) : null);
}

function planRow(c, paise, month, i, n, onTotal) {
  const input = h('input', {
    class: 'input budget-input num', type: 'text', inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off',
    value: paiseToInput(paise, { group: true }), 'aria-label': `${c.name} budget for ${monthLabel(month)} onward, in rupees`,
    onfocus: () => input.select(),
    onkeydown: (e) => { if (e.key === 'Enter') input.blur(); },
    onchange: async () => {
      const v = input.value.trim() === '' ? 0 : parseAmount(input.value);
      if (v === null) { input.value = paiseToInput(planFor(month)[c.id] ?? 0, { group: true }); toast('That isn’t an amount'); return; }
      await setBudget(month, c.id, v);
      input.value = paiseToInput(v, { group: true });
      onTotal();
      toast(`${c.name}: ${formatINR(v)} a month from ${monthLabel(month, { short: true })}`);
    },
  });
  return h('li', { class: 'plan-row' },
    h('button', { class: 'plan-cat', type: 'button', 'aria-label': `Edit ${c.name}`, onclick: () => editSheet(c, month) }, badge(c), h('span', { class: 'plan-name' }, c.name)),
    h('label', { class: 'budget-wrap' }, h('span', { class: 'rupee-sm', 'aria-hidden': 'true' }, '₹'), input),
    h('span', { class: 'reorder' },
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'aria-label': `Move ${c.name} up`, disabled: i === 0, onclick: async () => { await moveCategory(c.id, -1); refresh(); } }, icon('up')),
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'aria-label': `Move ${c.name} down`, disabled: i === n - 1, onclick: async () => { await moveCategory(c.id, 1); refresh(); } }, icon('down'))));
}

/** Add (cat = null) or edit a category: name, emoji, colour; editing also offers Archive. */
function editSheet(cat, month) {
  let color = cat?.color ?? COLORS[state.categories.length % COLORS.length];
  sheet(cat ? 'Edit category' : 'New category', (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const nameIn = h('input', { class: 'input', id: 'cat-name', maxlength: '40', value: cat?.name ?? '', placeholder: 'e.g. Groceries', autofocus: true, autocomplete: 'off' });
    const emojiIn = h('input', { class: 'input emoji-input', id: 'cat-emoji', maxlength: '8', value: cat?.emoji ?? '', placeholder: '🙂', autocomplete: 'off' });
    const budgetIn = cat ? null : h('input', { class: 'input num', id: 'cat-budget', inputmode: 'decimal', placeholder: '0', autocomplete: 'off' });
    const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' }, COLORS.map((c, i) => h('button', {
      class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(c === color), 'aria-label': `Colour ${i + 1}`, style: { '--c': c },
      onclick: (e) => { color = c; swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s === e.currentTarget))); },
    })));

    const save = async () => {
      const name = nameIn.value.trim();
      if (!name) { err.textContent = 'Give it a name.'; nameIn.focus(); return; }
      if (state.categories.some((c) => c.id !== cat?.id && !c.archived && c.name.toLowerCase() === name.toLowerCase())) { err.textContent = 'There’s already a category with that name.'; return; }
      const emoji = [...emojiIn.value.trim()].slice(0, 2).join('');
      if (cat) {
        await updateCategory(cat.id, { name, emoji, color });
        toast('Category updated');
      } else {
        const budget = budgetIn.value.trim() ? parseAmount(budgetIn.value) : 0;
        if (budget === null) { err.textContent = 'The budget isn’t an amount.'; return; }
        await addCategory({ name, emoji, color, budget }, month);
        toast(`${name} added from ${monthLabel(month, { short: true })}`);
      }
      close();
      refresh();
    };

    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      h('div', { class: 'field-grid' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Emoji'), emojiIn),
        h('label', { class: 'field grow' }, h('span', { class: 'field-label' }, 'Name'), nameIn)),
      budgetIn && h('label', { class: 'field' }, h('span', { class: 'field-label' }, `Monthly budget from ${monthLabel(month)} (₹)`), budgetIn),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colour'), swatches),
      err,
      h('button', { class: 'btn btn-primary btn-big', type: 'submit' }, cat ? 'Save' : 'Add category'),
      cat && h('button', {
        class: 'btn btn-ghost-danger', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Archive ${cat.name}?`,
            body: [`It leaves the plan from ${monthLabel(month)} onward. Earlier months, and every expense already logged in it, stay as they are.`, 'You can restore it from Plan any time.'],
            ok: 'Archive', danger: true,
          });
          if (!ok) return;
          await archiveCategory(cat.id, month);
          close();
          refresh();
          toast(`${catById(cat.id).name} archived`);
        },
      }, icon('archive'), 'Archive category'));
  });
}
