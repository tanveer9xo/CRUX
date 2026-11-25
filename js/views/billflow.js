// Bill rows and the pay / skip flow, shared by Home (Upcoming card) and the Bills screen.
import { h, badge, toast } from '../ui.js';
import { formatINR } from '../money.js';
import { dayLabel } from '../dates.js';
import { typeInfo, recurrenceInfo, billStatus, dueText, ARCHIVE_REASONS } from '../bills.js';
import { state, markBillPaid, skipBill, restoreBill } from '../store.js';
import { go, refresh } from '../router.js';

/** One bill as a row: tap the row for details, tap Paid to mark it paid. */
export function billRow(b, today, { onOpen } = {}) {
  const st = billStatus(b, today);
  const t = typeInfo(b.type);
  const amount = b.amount > 0 ? `≈ ${formatINR(b.amount, { decimals: 'never' })}` : 'Amount varies';
  const left = b.installmentsLeft !== null && b.installmentsLeft !== undefined ? ` · ${b.installmentsLeft} left` : '';
  return h('li', { class: `bill-row st-${st.state}` },
    h('button', {
      class: 'bill-main', type: 'button', onclick: () => (onOpen ? onOpen(b) : go('#/bills')),
      'aria-label': `${b.name}, ${dueText(b, today)}, ${amount}${left}`,
    },
    badge({ emoji: t.emoji, color: t.color }),
    h('span', { class: 'bill-text' },
      h('span', { class: 'bill-name' }, b.name),
      h('span', { class: `bill-sub ${st.state}` }, dueText(b, today)),
      h('span', { class: 'bill-sub muted' }, `${amount} · ${t.label} · ${recurrenceInfo(b.recurrence).label}${left}`))),
    h('button', { class: 'btn btn-small btn-paid', type: 'button', 'aria-label': `Mark ${b.name} paid`, onclick: () => payBill(b.id) }, 'Paid'));
}

function announce(r, verb) {
  const a = r.after;
  const msg = a.archived ? `${verb}. ${a.name} is finished (${ARCHIVE_REASONS[a.archivedReason]?.toLowerCase() ?? 'archived'}) and archived.` : `${verb}. Next due ${dayLabel(a.dueDate)}.`;
  toast(msg, { action: 'Undo', onAction: async () => { await restoreBill(r.before); refresh(); toast('Restored'); } });
  refresh();
}

/**
 * Mark paid. The due date moves on. If the bill logs expenses, the Add screen opens prefilled with its amount and
 * linked category to edit and save (or cancel to skip logging); otherwise a toast with Undo says what happened.
 */
export async function payBill(id) {
  const r = await markBillPaid(id);
  if (r.expense) {
    state.prefill = { ...r.expense, billName: r.after.name, before: r.before, after: r.after };
    go('#/add');
    return;
  }
  announce(r, 'Paid');
}

export async function skipBillOnce(id) {
  const r = await skipBill(id);
  announce(r, 'Skipped');
}
