// Bills & renewals: what's due, sorted by due date, with overdue / due soon / later states. In-app only.
import { h, icon, sheet, toast, confirmDialog, badge } from '../ui.js';
import { parseAmount, paiseToInput, formatINR } from '../money.js';
import { todayYmd, isYmd, longDate } from '../dates.js';
import {
  BILL_TYPES, RECURRENCES, DEFAULT_WARN_DAYS, defaultLogExpense, typeInfo, recurrenceInfo, billStatus, dueText, byDue, endedReason, ARCHIVE_REASONS,
  resolveSchedule, lastDayOfMonth,
} from '../bills.js';
import { state, saveBill, activeCategories, catById, restoreBill } from '../store.js';
import { refresh } from '../router.js';
import { pageHead, emptyState } from './common.js';
import { billRow, payBill, skipBillOnce } from './billflow.js';

export const name = 'bills';
export const tab = 'bills';
export const title = 'Bills';

const GROUPS = [['overdue', 'Overdue'], ['soon', 'Due soon'], ['later', 'Later']];

export function render() {
  const today = todayYmd();
  const active = state.bills.filter((b) => !b.archived).sort(byDue);
  const archived = state.bills.filter((b) => b.archived);
  const by = (s) => active.filter((b) => billStatus(b, today).state === s);
  return h('div', { class: 'page bills' },
    pageHead('Bills'),
    h('p', { class: 'muted small lede' }, 'Reminders live in the app only. Open CRUX to see what’s due; nothing is sent to you.'),
    active.length
      ? GROUPS.map(([k, label]) => (by(k).length ? h('section', { class: `bill-group g-${k}`, 'aria-label': label },
        h('h2', {}, label, h('span', { class: 'count' }, ` ${by(k).length}`)),
        h('ul', { class: 'bill-list' }, by(k).map((b) => billRow(b, today, { onOpen: billSheet })))) : null))
      : emptyState('No bills or renewals yet', 'Add credit card dues, EMIs, insurance and subscriptions to see what’s coming up.', null, 'calendar-check'),
    h('button', { class: 'btn btn-wide', type: 'button', id: 'new-bill', onclick: () => billForm(null) }, icon('plus'), 'New bill or renewal'),
    archived.length ? h('details', { class: 'archived' },
      h('summary', {}, `Finished & archived (${archived.length})`),
      h('ul', { class: 'plain-list' }, archived.sort(byDue).reverse().map((b) => h('li', { class: 'plain-row' },
        badge({ icon: typeInfo(b.type).icon, color: typeInfo(b.type).color }),
        h('span', { class: 'grow' }, h('span', { class: 'bill-name' }, b.name), h('span', { class: 'bill-sub muted' }, ARCHIVE_REASONS[b.archivedReason] ?? 'Archived')),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => billForm(b, { restoring: true }) }, 'Restore'))))) : null);
}

// ---------- details ----------
function billSheet(b) {
  const today = todayYmd();
  const t = typeInfo(b.type);
  const cat = b.categoryId ? catById(b.categoryId) : null;
  const facts = [
    [t.label, recurrenceInfo(b.recurrence).label],
    b.lastDay ? ['Due day', 'Last day of the month'] : null,
    ['Amount', b.amount > 0 ? `≈ ${formatINR(b.amount)}` : 'Varies'],
    b.installmentsLeft !== null && b.installmentsLeft !== undefined ? ['Instalments left', String(b.installmentsLeft)] : null,
    b.endDate ? ['Ends', longDate(b.endDate)] : null,
    ['Warns', `${b.warnDays} day${b.warnDays === 1 ? '' : 's'} before`],
    cat ? ['Category', cat.name] : null,
    ['When paid', b.logExpense ? 'Offers to log an expense' : 'Doesn’t log an expense'],
    b.note ? ['Note', b.note] : null,
  ].filter(Boolean);
  sheet(b.name, (close) => h('div', { class: 'sheet-body' },
    h('p', { class: `bill-sub ${billStatus(b, today).state} big` }, dueText(b, today)),
    h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', { class: 'muted small' }, k), h('dd', {}, v)])),
    h('button', { class: 'btn btn-primary btn-big', type: 'button', id: 'bill-paid', onclick: () => { close(); payBill(b.id); } }, icon('check'), 'Mark paid'),
    h('button', { class: 'btn', type: 'button', id: 'bill-skip', onclick: () => { close(); skipBillOnce(b.id); } }, 'Skip this one'),
    h('p', { class: 'muted small' }, 'Skip moves the date on without logging an expense' + (b.installmentsLeft !== null && b.installmentsLeft !== undefined ? ' and keeps the instalments left as they are.' : '.')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', id: 'bill-edit', onclick: () => { close(); billForm(b); } }, icon('edit'), 'Edit'),
      h('button', { class: 'btn btn-ghost-danger', type: 'button', id: 'bill-archive', onclick: () => { close(); archiveBill(b); } }, icon('archive'), 'Archive'))));
}

async function archiveBill(b) {
  const ok = await confirmDialog({ title: `Archive ${b.name}?`, body: ['It stops reminding you. You can restore it from “Finished & archived”.'], ok: 'Archive', danger: true });
  if (!ok) return;
  await saveBill({ ...b, archived: true, archivedReason: 'manual' });
  refresh();
  toast(`${b.name} archived`, { action: 'Undo', onAction: async () => { await restoreBill(b); refresh(); toast('Restored'); } });
}

// ---------- add / edit ----------
export function billForm(bill, { restoring = false } = {}) {
  let type = bill?.type ?? 'bill';
  let recurrence = bill?.recurrence ?? 'monthly';
  let logExpense = bill?.logExpense ?? defaultLogExpense(type);
  let logTouched = !!bill; // an existing choice is never overwritten by a type change
  let lastDay = bill?.lastDay === true; // "Last day of month": the due day tracks month length
  sheet(bill ? (restoring ? 'Restore bill' : 'Edit bill') : 'New bill or renewal', (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const nameIn = h('input', { class: 'input', id: 'bill-name', maxlength: '60', value: bill?.name ?? '', placeholder: 'e.g. Bike EMI', autofocus: true, autocomplete: 'off' });
    const amountIn = h('input', { class: 'input num', id: 'bill-amount', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Varies', value: bill?.amount > 0 ? paiseToInput(bill.amount) : '' });
    const dueIn = h('input', {
      class: 'input', id: 'bill-due', type: 'date', value: bill?.dueDate ?? todayYmd(), 'aria-label': 'Next due date',
      onchange: () => { if (lastDay && isYmd(dueIn.value)) dueIn.value = lastDayOfMonth(dueIn.value); },
    });
    const lastIn = h('input', {
      type: 'checkbox', id: 'bill-lastday', checked: lastDay,
      onchange: () => { lastDay = lastIn.checked; if (lastDay && isYmd(dueIn.value)) dueIn.value = lastDayOfMonth(dueIn.value); draw(); },
    });
    const lastBox = h('div', {});
    const warnIn = h('input', { class: 'input num', id: 'bill-warn', inputmode: 'numeric', autocomplete: 'off', value: String(bill?.warnDays ?? DEFAULT_WARN_DAYS), 'aria-label': 'Days before to warn' });
    const endIn = h('input', { class: 'input', id: 'bill-end', type: 'date', value: bill?.endDate ?? '', 'aria-label': 'End date (optional)' });
    const leftIn = h('input', { class: 'input num', id: 'bill-left', inputmode: 'numeric', autocomplete: 'off', placeholder: 'e.g. 12', value: bill?.installmentsLeft ?? '', 'aria-label': 'Instalments left' });
    const noteIn = h('input', { class: 'input', id: 'bill-note', maxlength: '200', value: bill?.note ?? '', placeholder: 'Optional', enterkeyhint: 'done' });
    const catIn = h('select', { class: 'input', id: 'bill-cat', 'aria-label': 'Linked category' },
      h('option', { value: '' }, 'None'),
      [...activeCategories(), ...(bill?.categoryId && catById(bill.categoryId)?.archived ? [catById(bill.categoryId)] : [])].map((c) => h('option', { value: c.id, selected: c.id === bill?.categoryId }, c.name)));
    const logIn = h('input', { type: 'checkbox', id: 'bill-log', checked: logExpense, onchange: () => { logExpense = logIn.checked; logTouched = true; } });

    const typeChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Type' });
    const recChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Repeats' });
    const emiBox = h('div', { class: 'field' });
    const endBox = h('div', { class: 'field' });
    const logHint = h('span', { class: 'muted small' });
    const showInstalments = () => type === 'emi' || (bill?.installmentsLeft !== null && bill?.installmentsLeft !== undefined);

    const draw = () => {
      typeChips.replaceChildren(...BILL_TYPES.map((t) => h('button', {
        class: 'chip chip-small', type: 'button', role: 'radio', 'aria-checked': String(t.id === type), dataset: { type: t.id },
        onclick: () => {
          type = t.id;
          if (!logTouched) { logExpense = defaultLogExpense(type); logIn.checked = logExpense; } // card dues default to off
          draw();
        },
      }, badge({ icon: t.icon, color: t.color }, 'badge badge-small'), t.label)));
      recChips.replaceChildren(...RECURRENCES.map((r) => h('button', {
        class: 'chip chip-small', type: 'button', role: 'radio', 'aria-checked': String(r.id === recurrence), dataset: { rec: r.id },
        onclick: () => { recurrence = r.id; draw(); },
      }, r.label)));
      emiBox.replaceChildren(...(showInstalments() ? [h('label', { class: 'field-label', for: 'bill-left' }, 'Instalments left (optional)'), leftIn, h('span', { class: 'muted small' }, 'Counts down each time you mark it paid; archives itself at 0.')] : []));
      emiBox.hidden = !showInstalments();
      endBox.replaceChildren(...(recurrence !== 'once' ? [h('label', { class: 'field-label', for: 'bill-end' }, 'End date (optional)'), endIn] : []));
      endBox.hidden = recurrence === 'once';
      lastBox.replaceChildren(...(recurrence !== 'once' ? [h('label', { class: 'toggle' }, lastIn, h('span', {}, h('strong', {}, 'Last day of the month'), h('br', {}),
        h('span', { class: 'muted small' }, lastDay ? 'Due on the 28th, 29th, 30th or 31st, whichever is the month’s last day. The date above is set to the last day of its month.' : 'Turn on for bills due at month end, so the due day follows the month’s length.')))] : []));
      logHint.textContent = type === 'cc' ? 'Off by default for card dues: the card’s purchases are already logged, so this would count the money twice.' : '';
    };
    draw();

    const save = async () => {
      const nm = nameIn.value.trim();
      if (!nm) { err.textContent = 'Give it a name.'; nameIn.focus(); return; }
      if (!isYmd(dueIn.value)) { err.textContent = 'Pick the next due date.'; return; }
      const amount = amountIn.value.trim() === '' ? null : parseAmount(amountIn.value);
      if (amountIn.value.trim() !== '' && amount === null) { err.textContent = 'The amount isn’t valid.'; return; }
      const warn = Number(warnIn.value.trim() === '' ? DEFAULT_WARN_DAYS : warnIn.value);
      if (!Number.isInteger(warn) || warn < 0 || warn > 90) { err.textContent = 'Warn days must be a whole number from 0 to 90.'; return; }
      let left = null;
      if (showInstalments() && leftIn.value.trim() !== '') {
        left = Number(leftIn.value);
        if (!Number.isInteger(left) || left < 0 || left > 1200) { err.textContent = 'Instalments left must be a whole number.'; return; }
      }
      const end = recurrence === 'once' || endIn.value === '' ? null : endIn.value;
      if (end && !isYmd(end)) { err.textContent = 'The end date isn’t valid.'; return; }
      // The day it is really due (see resolveSchedule: "last day of month", or a fixed day that unchanged dates keep).
      const sched = resolveSchedule({ dueDate: dueIn.value, lastDay: lastDay && recurrence !== 'once', previous: bill });
      let next = {
        ...bill, name: nm, type, amount, recurrence, ...sched, warnDays: warn, endDate: end, installmentsLeft: left,
        note: noteIn.value.trim().slice(0, 200), categoryId: catIn.value || null, logExpense: logIn.checked, archived: false, archivedReason: null,
      };
      const reason = endedReason(next);
      if (reason) next = { ...next, archived: true, archivedReason: reason };
      await saveBill(next);
      close();
      refresh();
      if (reason) toast(`Saved, and archived: ${ARCHIVE_REASONS[reason].toLowerCase()}.`, { action: 'Undo', onAction: async () => { await saveBill({ ...next, archived: false, archivedReason: null }); refresh(); } });
      else toast(bill ? (restoring ? `${nm} restored` : 'Bill updated') : `${nm} added`);
    };

    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      field('Name', nameIn),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Type'), typeChips),
      field('Approx. amount (₹, optional)', amountIn),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Repeats'), recChips),
      field('Next due date', dueIn),
      lastBox,
      field('Warn me this many days before', warnIn),
      emiBox,
      endBox,
      field('Linked category (optional)', catIn),
      h('label', { class: 'toggle' }, logIn, h('span', {}, h('strong', {}, 'Log an expense when paid'), h('br', {}), h('span', { class: 'muted small' }, 'Mark paid then opens Add with the amount and category filled in.')), ),
      logHint,
      field('Note', noteIn),
      err,
      h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'bill-save' }, bill ? 'Save' : 'Add'));
  });
}
