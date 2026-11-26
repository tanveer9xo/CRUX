// Income: what came in, and recurring monthly income (e.g. Salary) that is confirmed with a tap, like a bill.
// Income is its own list: never an expense, never a goal add.
import { h, icon, badge, sheet, toast, confirmDialog } from '../ui.js';
import { parseAmount, paiseToInput, formatINR } from '../money.js';
import { todayYmd, monthOf, isYmd, isMonth, dayLabel, longDate } from '../dates.js';
import { resolveSchedule, lastDayOfMonth } from '../bills.js';
import { incomeForMonth, sourceStatus } from '../income.js';
import {
  state, saveIncome, deleteIncome, restoreIncome, saveSource, receiveSource, undoReceive, skipSource, sourceById, periods, cycleMode,
} from '../store.js';
import { refresh, setQuery } from '../router.js';
import { pageHead, emptyState } from './common.js';
import { periodNav, unitWord } from './cyclesui.js';

export const name = 'income';
export const tab = null;
export const title = 'Income';

const money = (v, o) => formatINR(v, { decimals: 'auto', ...o });
const INCOME = { icon: 'banknote', color: '#4FAF86' };
const SUGGESTED = ['Salary', 'Bonus', 'Other'];
const ordinal = (n) => { const v = n % 100; const sfx = ['th', 'st', 'nd', 'rd']; return n + (sfx[(v - 20) % 10] || sfx[v] || sfx[0]); };

export function render({ query }) {
  const today = todayYmd();
  const P = periods();
  const current = P.current().key;
  const per = isMonth(query.get('m')) && query.get('m') <= current ? P.byKey(query.get('m')) : P.current();
  const month = per.key;
  const unit = unitWord();
  const inc = incomeForMonth(state.income, state.incomeSources, per, today);
  const entries = state.income.filter((e) => e.date >= per.from && e.date <= per.to);
  const sources = state.incomeSources.filter((s) => !s.archived);
  const archived = state.incomeSources.filter((s) => s.archived);
  return h('div', { class: 'page income' },
    pageHead('Income'),
    periodNav(per, (m) => setQuery({ m: m === current ? null : m }), { maxKey: current }),
    h('section', { class: 'card' },
      h('p', { class: 'muted small' }, 'Received'),
      h('p', { class: 'hero-amt num', id: 'income-received' }, money(inc.received)),
      month === current && inc.pending > 0 ? h('p', { class: 'muted' }, `Expected this ${unit}: `, h('span', { class: 'num strong' }, money(inc.expected)), ` (${money(inc.pending)} still to come)`) : null,
      h('p', { class: 'muted small' }, 'Income is kept apart from spending: it never counts as an expense or a goal entry.')),
    h('button', { class: 'btn btn-primary btn-big', type: 'button', id: 'add-income', onclick: () => incomeSheet(null) }, icon('plus'), 'Add income'),

    h('h2', {}, 'Recurring income'),
    sources.length ? h('ul', { class: 'bill-list' }, sources.map((s) => sourceRow(s, today))) : h('p', { class: 'muted' }, 'Set up your salary once and CRUX will ask you to confirm it each month.'),
    h('button', { class: 'btn btn-wide', type: 'button', id: 'new-source', onclick: () => sourceForm(null) }, icon('plus'), 'Set up recurring income'),

    h('h2', {}, `Received this ${unit} (${entries.length})`),
    entries.length ? h('ul', { class: 'entry-list' }, entries.map((e) => h('li', {},
      h('button', { class: 'entry', type: 'button', onclick: () => incomeSheet(e), 'aria-label': `${e.source}, ${money(e.amount)}, ${dayLabel(e.date)}. Edit` },
        badge(INCOME),
        h('span', { class: 'entry-text' }, h('span', { class: 'entry-cat' }, e.source), h('span', { class: 'entry-note' }, [dayLabel(e.date), e.note].filter(Boolean).join(' · '))),
        h('span', { class: 'entry-amt num' }, money(e.amount, { sign: true })))))) : emptyState('Nothing received yet', 'Use Add income, or confirm a recurring income when it arrives.'),

    archived.length ? h('details', { class: 'archived' },
      h('summary', {}, `Archived recurring income (${archived.length})`),
      h('ul', { class: 'plain-list' }, archived.map((s) => h('li', { class: 'plain-row' }, badge(INCOME), h('span', { class: 'grow' }, s.name),
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => { await saveSource({ ...s, archived: false }); refresh(); toast(`${s.name} is back`); } }, 'Restore'))))) : null);
}

// ---------- recurring rows ----------
/** One recurring income as a row: tap for details, tap Received to confirm it arrived. Shared with Home. */
export function sourceRow(s, today) {
  const st = sourceStatus(s, today);
  const when = st.days < 0 ? `${-st.days} day${st.days === -1 ? '' : 's'} late · ${dayLabel(s.nextDate)}` : st.days === 0 ? `Expected today · ${dayLabel(s.nextDate)}` : `Expected ${dayLabel(s.nextDate)} · in ${st.days} day${st.days === 1 ? '' : 's'}`;
  return h('li', { class: `bill-row st-${st.state === 'late' ? 'overdue' : st.state}` },
    h('button', { class: 'bill-main', type: 'button', onclick: () => sourceSheet(s), 'aria-label': `${s.name}, ${when}` },
      badge(INCOME),
      h('span', { class: 'bill-text' },
        h('span', { class: 'bill-name' }, s.name),
        h('span', { class: `bill-sub ${st.state === 'late' ? 'overdue' : st.state}` }, when),
        h('span', { class: 'bill-sub muted' }, `${s.amount > 0 ? `≈ ${money(s.amount, { decimals: 'never' })}` : 'Amount varies'} · Monthly`))),
    h('button', { class: 'btn btn-small btn-paid', type: 'button', 'aria-label': `Confirm ${s.name} received`, onclick: () => confirmReceived(s.id) }, 'Received'));
}

/** One tap: logs the expected amount as received today and moves the date on, with Undo. Asks for the amount if unknown. */
export async function confirmReceived(id) {
  const s = sourceById(id);
  if (!s) return;
  if (!(s.amount > 0)) { receivedSheet(s); return; }
  await doReceive(id);
}

async function doReceive(id, amount) {
  const r = await receiveSource(id, { amount });
  refresh();
  toast(`Received ${money(r.entry.amount)} from ${r.after.name}. Next expected ${dayLabel(r.after.nextDate)}.`, {
    action: 'Undo', onAction: async () => { await undoReceive(r); refresh(); toast('Undone'); },
  });
}

function receivedSheet(s) {
  sheet(`${s.name} received`, (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const amountIn = h('input', { class: 'input amount-small num', id: 'recv-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', autofocus: true, 'aria-label': 'Amount received in rupees' });
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const paise = parseAmount(amountIn.value);
      if (!paise) { err.textContent = 'Enter the amount received.'; return; }
      close();
      await doReceive(s.id, paise);
    } },
    h('p', { class: 'muted' }, 'This one has no fixed amount. How much came in?'),
    h('label', { class: 'amount-wrap amount-wrap-small', for: 'recv-amount' }, h('span', { class: 'rupee', 'aria-hidden': 'true' }, '₹'), amountIn),
    err,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'recv-save' }, icon('check'), 'Confirm received'));
  });
}

function sourceSheet(s) {
  const today = todayYmd();
  const st = sourceStatus(s, today);
  const facts = [
    ['Repeats', s.lastDay ? 'Monthly, on the last day' : `Monthly, on the ${ordinal(s.anchorDay)}`],
    ['Amount', s.amount > 0 ? `≈ ${money(s.amount)}` : 'Varies'],
    ['Next expected', longDate(s.nextDate)],
    s.note ? ['Note', s.note] : null,
  ].filter(Boolean);
  sheet(s.name, (close) => h('div', { class: 'sheet-body' },
    h('p', { class: `bill-sub ${st.state === 'late' ? 'overdue' : st.state} big` }, st.days < 0 ? `${-st.days} day${st.days === -1 ? '' : 's'} late` : st.days === 0 ? 'Expected today' : `Expected in ${st.days} day${st.days === 1 ? '' : 's'}`),
    h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', { class: 'muted small' }, k), h('dd', {}, v)])),
    h('button', { class: 'btn btn-primary btn-big', type: 'button', id: 'src-received', onclick: () => { close(); confirmReceived(s.id); } }, icon('check'), 'Mark received'),
    h('button', { class: 'btn', type: 'button', id: 'src-skip', onclick: async () => {
      close();
      const r = await skipSource(s.id);
      refresh();
      toast(`Skipped this month. Next expected ${dayLabel(r.after.nextDate)}.`, { action: 'Undo', onAction: async () => { await saveSource(r.before); refresh(); toast('Restored'); } });
    } }, 'Not this month (skip)'),
    h('p', { class: 'muted small' }, 'Skip moves the date on and logs nothing.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', id: 'src-edit', onclick: () => { close(); sourceForm(s); } }, icon('edit'), 'Edit'),
      h('button', { class: 'btn btn-ghost-danger', type: 'button', id: 'src-archive', onclick: async () => {
        close();
        const ok = await confirmDialog({ title: `Archive ${s.name}?`, body: ['It stops asking you to confirm it. Income already logged stays. You can restore it later.'], ok: 'Archive', danger: true });
        if (!ok) return;
        await saveSource({ ...s, archived: true });
        refresh();
        toast(`${s.name} archived`, { action: 'Undo', onAction: async () => { await saveSource(s); refresh(); toast('Restored'); } });
      } }, icon('archive'), 'Archive'))));
}

// ---------- add / edit recurring income ----------
function sourceForm(src) {
  let lastDay = src?.lastDay === true;
  sheet(src ? 'Edit recurring income' : 'Set up recurring income', (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const nameIn = h('input', { class: 'input', id: 'src-name', maxlength: '40', value: src?.name ?? 'Salary', autocomplete: 'off', autofocus: true });
    const amountIn = h('input', { class: 'input num', id: 'src-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Varies', value: src?.amount > 0 ? paiseToInput(src.amount) : '' });
    const dateIn = h('input', {
      class: 'input', id: 'src-date', type: 'date', value: src?.nextDate ?? todayYmd(), 'aria-label': 'Next expected date',
      onchange: () => { if (lastDay && isYmd(dateIn.value)) dateIn.value = lastDayOfMonth(dateIn.value); },
    });
    const noteIn = h('input', { class: 'input', id: 'src-note', maxlength: '200', value: src?.note ?? '', placeholder: 'Optional', enterkeyhint: 'done' });
    const lastBox = h('div', {});
    const lastIn = h('input', { type: 'checkbox', id: 'src-lastday', checked: lastDay, onchange: () => { lastDay = lastIn.checked; if (lastDay && isYmd(dateIn.value)) dateIn.value = lastDayOfMonth(dateIn.value); draw(); } });
    const cycleIn = h('input', { type: 'checkbox', id: 'src-cycle', checked: src ? !!src.startsCycle : /salary/i.test(nameIn.value) });
    const draw = () => lastBox.replaceChildren(cycleMode() ? h('label', { class: 'toggle' }, cycleIn, h('span', {}, h('strong', {}, 'This is my salary: it starts a new pay cycle'), h('br', {}),
      h('span', { class: 'muted small' }, 'It is then expected on each cycle’s start, and confirming it can start the next cycle.'))) : null, h('label', { class: 'toggle' }, lastIn, h('span', {}, h('strong', {}, 'Last day of the month'), h('br', {}),
      h('span', { class: 'muted small' }, lastDay ? 'Expected on the 28th–31st, whichever is the month’s last day.' : 'Otherwise the same day each month; in shorter months it falls on the last day.'))));
    draw();
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);

    const save = async () => {
      const nm = nameIn.value.trim();
      if (!nm) { err.textContent = 'Give it a name.'; nameIn.focus(); return; }
      if (state.incomeSources.some((s) => s.id !== src?.id && !s.archived && s.name.toLowerCase() === nm.toLowerCase())) { err.textContent = 'There’s already a recurring income with that name.'; return; }
      if (!isYmd(dateIn.value)) { err.textContent = 'Pick the next expected date.'; return; }
      const amount = amountIn.value.trim() === '' ? null : parseAmount(amountIn.value);
      if (amountIn.value.trim() !== '' && amount === null) { err.textContent = 'The amount isn’t valid.'; return; }
      const sched = resolveSchedule({ dueDate: dateIn.value, lastDay, previous: src ? { ...src, dueDate: src.nextDate } : null });
      const startsCycle = cycleMode() ? cycleIn.checked : !!src?.startsCycle;
      await saveSource({ ...src, name: nm, amount, nextDate: sched.dueDate, anchorDay: sched.anchorDay, lastDay: sched.lastDay, startsCycle, note: noteIn.value.trim().slice(0, 200), archived: src?.archived ?? false });
      close();
      refresh();
      toast(src ? 'Recurring income updated' : `${nm} set up`);
    };
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      field('Name', nameIn),
      field('Expected amount (₹, optional)', amountIn, 'Used for the month plan and as the amount when you confirm it.'),
      field('Next expected date', dateIn, 'Its day of the month is the expected day.'),
      lastBox,
      field('Note', noteIn),
      err,
      h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'src-save' }, src ? 'Save' : 'Set up'));
  });
}

// ---------- add / edit one income entry ----------
export function incomeSheet(entry) {
  sheet(entry ? 'Edit income' : 'Add income', (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const sourceIn = h('input', { class: 'input', id: 'inc-source', maxlength: '40', value: entry?.source ?? '', placeholder: 'Source, e.g. Bonus', autocomplete: 'off', autofocus: !entry, 'aria-label': 'Source' });
    const amountIn = h('input', { class: 'input amount-small num', id: 'inc-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: entry ? paiseToInput(entry.amount) : '', 'aria-label': 'Amount in rupees',
      oninput: () => { amountIn.value = amountIn.value.replace(/[^\d.,]/g, ''); err.textContent = ''; } });
    const dateIn = h('input', { class: 'input', id: 'inc-date', type: 'date', value: entry?.date ?? todayYmd(), 'aria-label': 'Date received' });
    const noteIn = h('input', { class: 'input', id: 'inc-note', maxlength: '200', value: entry?.note ?? '', placeholder: 'Note (optional)', enterkeyhint: 'done' });
    const names = [...new Set([...SUGGESTED, ...state.incomeSources.map((s) => s.name), ...state.income.map((e) => e.source)])].slice(0, 8);
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Source' }, names.map((n) => h('button', {
      class: 'chip chip-small', type: 'button', onclick: () => { sourceIn.value = n; err.textContent = ''; amountIn.focus(); },
    }, n)));
    const save = async () => {
      const src = sourceIn.value.trim();
      const paise = parseAmount(amountIn.value);
      if (!src) { err.textContent = 'Which source? Pick one above or type it.'; sourceIn.focus(); return; }
      if (!paise) { err.textContent = 'Enter an amount above ₹0.'; amountIn.focus(); return; }
      if (!isYmd(dateIn.value)) { err.textContent = 'Pick the date received.'; return; }
      const linked = state.incomeSources.find((s) => s.name.toLowerCase() === src.toLowerCase());
      await saveIncome({ ...entry, source: src, amount: paise, date: dateIn.value, note: noteIn.value.trim().slice(0, 200), sourceId: entry ? entry.sourceId : linked?.id ?? null });
      close();
      refresh();
      toast(`${entry ? 'Updated' : 'Added'} ${money(paise)} from ${src}`);
    };
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      sourceIn, chips,
      h('label', { class: 'amount-wrap amount-wrap-small', for: 'inc-amount' }, h('span', { class: 'rupee', 'aria-hidden': 'true' }, '₹'), amountIn),
      err,
      h('div', { class: 'field-row' }, dateIn),
      noteIn,
      h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'inc-save' }, icon('check'), 'Save'),
      entry ? h('button', {
        class: 'btn btn-ghost-danger', type: 'button',
        onclick: async () => {
          const gone = await deleteIncome(entry.id);
          close();
          refresh();
          toast(`Deleted ${money(gone.amount)}`, { action: 'Undo', onAction: async () => { await restoreIncome(gone); refresh(); toast('Restored'); } });
        },
      }, icon('trash'), 'Delete this entry') : null);
  });
}
