// Pay-cycle UI shared by Home, History, Insights, Plan, the Month plan, Income and Settings: the period navigator
// (name with its dates underneath), the cycle picker, "Salary received / Start new cycle", editing a cycle's start
// with a preview of what moves, and the one-time migration summary.
import { h, icon, sheet, toast } from '../ui.js';
import { formatINR } from '../money.js';
import { todayYmd, isYmd, dayLabel, longDate, monthLabel } from '../dates.js';
import {
  state, periods, cycleMode, startCycle, previewCycleEdit, editCycle, cycleMigrationPreview, useCycles, useCalendarMonths, receiveSource,
} from '../store.js';
import { refresh } from '../router.js';

export const unitWord = () => (cycleMode() ? 'cycle' : 'month');

/** "December", "29 Oct – 26 Nov · expected". */
export function periodTitle(p) {
  return h('span', { class: 'period-title' },
    h('span', { class: 'period-name' }, p.label),
    p.kind === 'cycle' ? h('span', { class: 'period-range' }, p.range, !p.confirmed ? h('span', { class: 'tag' }, 'expected') : null) : null);
}

/**
 * ‹ name / dates › — tapping the name opens the cycle picker in cycle mode. `onChange(key)` gets the chosen period's key.
 * `maxKey`: the latest key allowed (no browsing into the future beyond it).
 */
export function periodNav(p, onChange, { maxKey } = {}) {
  const P = periods();
  const prev = P.prev(p);
  const next = P.next(p);
  return h('div', { class: 'month-nav period-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Previous: ${prev.label}`, onclick: () => onChange(prev.key) }, icon('left')),
    cycleMode()
      ? h('button', { class: 'period-btn', type: 'button', id: 'period-picker', 'aria-label': `${p.label}, ${p.range}. Choose a cycle`, onclick: () => cyclePicker({ onPick: onChange, maxKey }) }, periodTitle(p))
      : h('h2', { class: 'month-nav-label', 'aria-live': 'polite' }, p.label),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Next: ${next.label}`, disabled: !!maxKey && next.key > maxKey, onclick: () => onChange(next.key) }, icon('right')));
}

/** The cycle picker: recent and next cycles with dates and whether their start is confirmed or expected. */
export function cyclePicker({ onPick, maxKey } = {}) {
  const P = periods();
  const cur = P.current();
  const list = [...P.ending(cur, 12), P.next(cur)].reverse();
  sheet('Pay cycles', (close) => h('div', { class: 'sheet-body' },
    h('p', { class: 'muted small' }, 'Each cycle runs from one salary day to the day before the next, and is named after the month it mostly covers.'),
    h('ul', { class: 'cycle-list', id: 'cycle-list' }, list.map((p) => h('li', { class: `cycle-row${p.key === cur.key ? ' current' : ''}` },
      h('button', {
        class: 'cycle-pick', type: 'button', disabled: !!maxKey && p.key > maxKey, dataset: { key: p.key },
        onclick: () => { close(); onPick?.(p.key); },
      }, h('span', { class: 'grow' }, h('span', { class: 'strong' }, p.label), h('span', { class: 'muted small cycle-dates' }, `${p.range} · ${p.days} days`)),
      h('span', { class: `tag ${p.confirmed ? 'tag-ok' : ''}` }, p.key === P.next(cur).key ? 'next, expected' : p.confirmed ? 'confirmed' : 'expected')),
      p.from <= todayYmd() && state.cycles.some((c) => c.start === p.from)
        ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Edit when the ${p.label} cycle starts`, dataset: { edit: p.from }, onclick: () => { close(); editStartSheet(p); } }, icon('edit'))
        : null))),
    h('button', { class: 'btn btn-primary btn-big', type: 'button', id: 'picker-salary', onclick: () => { close(); salarySheet(); } }, icon('banknote'), 'Salary received')));
}

/** "Salary received / Start new cycle now": choose the date (today by default) and optionally log the salary. */
export function salarySheet() {
  const P = periods();
  const cur = P.current();
  const salary = state.incomeSources.find((s) => !s.archived && s.startsCycle);
  sheet('Salary received', (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const dateIn = h('input', { class: 'input', type: 'date', id: 'salary-date', value: todayYmd(), 'aria-label': 'Salary date' });
    const log = salary && salary.amount > 0 ? h('input', { type: 'checkbox', id: 'salary-log', checked: true }) : null;
    const preview = h('p', { class: 'note-record muted small', id: 'salary-preview' });
    const draw = () => {
      if (!isYmd(dateIn.value)) { preview.textContent = ''; return; }
      const n = state.entries.filter((e) => e.date >= dateIn.value && e.date <= todayYmd()).length;
      preview.textContent = `The new cycle starts ${longDate(dateIn.value)}.${n ? ` ${n} expense${n === 1 ? '' : 's'} dated from then will count in it.` : ''}`;
    };
    dateIn.addEventListener('change', draw);
    draw();
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!isYmd(dateIn.value)) { err.textContent = 'Pick the date your salary arrived.'; return; }
      const problem = await startCycle(dateIn.value);
      if (problem) { err.textContent = problem; return; }
      if (log?.checked) await receiveSource(salary.id, { date: dateIn.value });
      close();
      refresh();
      const now = periods().current();
      toast(`The ${now.label.split(' ')[0]} cycle started ${dayLabel(now.from)}.${log?.checked ? ` ${formatINR(salary.amount)} salary logged.` : ''}`);
    } },
    h('p', { class: 'muted' }, `Your ${cur.label.split(' ')[0]} cycle (${cur.range}) ends the day before this date, and the next cycle starts on it.`),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Salary arrived on'), dateIn),
    log ? h('label', { class: 'toggle' }, log, h('span', {}, h('strong', {}, `Also log ${salary.name} (${formatINR(salary.amount)}) as received`))) : null,
    preview, err,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'salary-save' }, icon('check'), 'Start the new cycle'));
  });
}

/** Move a cycle's start, with a live preview of which expenses would move between cycles. */
export function editStartSheet(p) {
  sheet(`When the ${p.label.split(' ')[0]} cycle starts`, (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const dateIn = h('input', { class: 'input', type: 'date', id: 'edit-start', value: p.from, 'aria-label': 'Cycle start date' });
    const out = h('div', { class: 'note-record', id: 'edit-preview' });
    const draw = () => {
      if (!isYmd(dateIn.value) || dateIn.value === p.from) { out.replaceChildren(h('p', { class: 'muted small' }, 'Pick a new start date to see what would move.')); err.textContent = ''; return; }
      const r = previewCycleEdit(p.from, dateIn.value);
      err.textContent = r.error ?? '';
      out.replaceChildren(r.error ? h('p', { class: 'muted small' }, 'Nothing would change.')
        : r.moved.length
          ? h('div', {}, h('p', { class: 'strong small' }, `${r.moved.length} expense${r.moved.length === 1 ? '' : 's'} would move:`),
            h('ul', { class: 'moved-list' }, r.moved.slice(0, 8).map((m) => h('li', { class: 'small' }, `${dayLabel(m.entry.date)} · ${formatINR(m.entry.amount)}: ${monthLabel(m.from, { short: true })} → ${monthLabel(m.to, { short: true })}`))),
            r.moved.length > 8 ? h('p', { class: 'muted small' }, `and ${r.moved.length - 8} more`) : null)
          : h('p', { class: 'muted small' }, 'No expenses would change cycle.'));
    };
    dateIn.addEventListener('change', draw);
    draw();
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const problem = await editCycle(p.from, dateIn.value);
      if (problem) { err.textContent = problem; return; }
      close();
      refresh();
      toast(`The ${p.label.split(' ')[0]} cycle now starts ${dayLabel(dateIn.value)}. Expenses moved to match.`);
    } },
    h('p', { class: 'muted' }, `Now ${p.range}. Expenses keep their dates; only the cycle they count in can change. Cycles can’t overlap or have no days.`),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Starts on'), dateIn),
    out, err,
    h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'edit-start-save' }, 'Save start date'));
  });
}

/** The one-time summary before existing data moves onto pay cycles. Nothing changes until "Switch to pay cycles". */
export function migrationSheet() {
  const s = cycleMigrationPreview();
  sheet('Switch to pay cycles?', (close) => h('div', { class: 'sheet-body', id: 'migration' },
    h('p', { class: 'muted' }, `Budgets and totals would follow your salary: each cycle runs from the ${ordinalRule()} working day of a month to the day before the next one.`),
    h('ul', { class: 'facts-list' },
      h('li', {}, h('strong', {}, `${s.cycles} cycle${s.cycles === 1 ? '' : 's'}`), s.cycles === 1 ? ` created: ${s.current.label} (${s.current.range}).` : ` created, from ${s.first.label} (${s.first.range}) to ${s.current.label} (${s.current.range}).`),
      h('li', {}, h('strong', {}, `${s.budgetMonths} month${s.budgetMonths === 1 ? '' : 's'} of budgets`), ' copied onto the cycle with the same name', s.carriedFrom ? `; ${monthLabel(s.carriedFrom)}’s budgets carry forward to ${s.current.label}.` : '.'),
      h('li', {}, s.moved
        ? [h('strong', {}, `${s.moved} of ${s.total} expense${s.total === 1 ? '' : 's'}`), ' would count in a different period (their dates don’t change):']
        : [h('strong', {}, s.total === 1 ? 'Your 1 expense' : `All ${s.total} expenses`), ` stay${s.total === 1 ? 's' : ''} in the same period.`])),
    s.groups.length ? h('ul', { class: 'moved-list', id: 'migration-groups' }, s.groups.map((g) => h('li', { class: 'small' }, `${g.count} from ${monthLabel(g.from, { short: true })} → the ${monthLabel(g.to, { short: true })} cycle (${formatINR(g.amount)})`))) : null,
    h('p', { class: 'note-record muted small' }, 'Your calendar-month budgets are kept: switching back to Calendar month in Settings restores them exactly.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', id: 'migration-keep', onclick: async () => { await useCalendarMonths(); close(); refresh(); toast('Staying on calendar months. You can switch in Settings.'); } }, 'Keep calendar months'),
      h('button', { class: 'btn btn-primary', type: 'button', id: 'migration-apply', onclick: async () => { await useCycles(); close(); refresh(); toast(`Switched to pay cycles. This is the ${periods().current().label.split(' ')[0]} cycle.`); } }, 'Switch to pay cycles'))));
}

const ordinalRule = () => (['', 'last', 'second-last', 'third-last', 'fourth-last', 'fifth-last'][state.periodSettings.nthLast] ?? `${state.periodSettings.nthLast}th-last`);
export { ordinalRule };
