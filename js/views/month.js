// Month plan: income − category budgets − planned goal contributions = unassigned, and the leftover you can allocate.
// Allocating records goal entries in CRUX. It does not move real money.
import { h, icon, sheet, toast, badge } from '../ui.js';
import { parseAmount, paiseToInput, formatINR } from '../money.js';
import { todayYmd, monthOf, isMonth, addMonths, monthLabel } from '../dates.js';
import { totalBudget } from '../budget.js';
import { incomeForMonth, monthPlan, plannedGoalTotal, leftoverFor, plannedRemaining, prefillAllocation, checkAllocation } from '../income.js';
import { state, planFor, saveGoalAdds, deleteGoalAdds } from '../store.js';
import { go, refresh, setQuery } from '../router.js';
import { pageHead, monthNav } from './common.js';

export const name = 'month';
export const tab = null;
export const title = 'Month plan';

const money = (v, o) => formatINR(v, { decimals: 'auto', ...o });

/** All the numbers for a month: the plan (against expected income) and the leftover (against what has arrived). */
export function monthFigures(month, today) {
  const inc = incomeForMonth(state.income, state.incomeSources, month, today);
  const plan = monthPlan({ expected: inc.expected, received: inc.received, budgetTotal: totalBudget(planFor(month)), goalPlanTotal: plannedGoalTotal(state.goals) });
  const lo = leftoverFor({ income: state.income, entries: state.entries, goalAdds: state.goalAdds, month });
  return { inc, plan, lo };
}

export function render({ query }) {
  const today = todayYmd();
  const current = monthOf(today);
  const month = isMonth(query.get('m')) ? query.get('m') : current;
  const { inc, plan: p, lo } = monthFigures(month, today);
  const goalsPlanned = state.goals.filter((g) => !g.archived && g.monthlyPlan > 0);
  const canAllocate = month === current && lo.leftover > 0 && state.goals.some((g) => !g.archived);

  return h('div', { class: 'page month' },
    pageHead('Month plan'),
    monthNav(month, (m) => setQuery({ m: m === current ? null : m }), { max: addMonths(current, 1) }),

    h('section', { class: 'card plan-card', 'aria-labelledby': 'h-plan' },
      h('h2', { id: 'h-plan' }, 'The plan'),
      line('Income expected', money(p.expected), 'plus', h('a', { class: 'link', href: '#/income' }, 'Income')),
      h('p', { class: 'muted small ind' }, `Received so far ${money(p.received)}`, inc.pending > 0 ? ` · ${money(inc.pending)} still expected` : ''),
      line('Category budgets', money(p.budgetTotal), 'minus', h('a', { class: 'link', href: '#/plan' }, 'Plan')),
      line('Planned for goals', money(p.goalPlanTotal), 'minus', h('a', { class: 'link', href: '#/goals' }, 'Goals')),
      goalsPlanned.length ? h('ul', { class: 'ind small muted plan-goals' }, goalsPlanned.map((g) => h('li', {}, badge(g, 'badge badge-small'), `${g.name}: ${money(g.monthlyPlan)}`))) : null,
      h('div', { class: `result ${p.over ? 'warn' : ''}`, id: 'unassigned' },
        p.over ? [icon('alert', 'ic ic-inline'), h('span', {}, 'Over-planned by '), h('strong', { class: 'num' }, money(p.overBy))]
          : [h('span', {}, 'Unassigned '), h('strong', { class: 'num' }, money(p.unassigned))]),
      p.expected === 0 ? h('p', { class: 'muted small' }, 'No income yet for this month. Add it in Income to see what’s left to assign.') : null,
      p.over ? h('p', { class: 'muted small' }, 'Budgets and goal plans add up to more than the income you expect. Lower a budget or a goal’s monthly plan.') : null),

    h('section', { class: 'card plan-card', 'aria-labelledby': 'h-left' },
      h('h2', { id: 'h-left' }, 'Leftover so far'),
      line('Income received', money(lo.received), 'plus'),
      line('Expenses logged', money(lo.spent), 'minus'),
      line('Added to goals', money(lo.saved), 'minus'),
      h('div', { class: `result ${lo.leftover < 0 ? 'warn' : ''}`, id: 'leftover' },
        lo.leftover < 0 ? [icon('alert', 'ic ic-inline'), h('span', {}, 'Over by '), h('strong', { class: 'num' }, money(-lo.leftover))]
          : [h('span', {}, 'Leftover '), h('strong', { class: 'num' }, money(lo.leftover))]),
      lo.leftover < 0 ? h('p', { class: 'muted small' }, 'You’ve spent and saved more than has come in so far this month.') : null,
      month === current
        ? h('button', { class: 'btn btn-primary btn-big', type: 'button', id: 'allocate', disabled: !canAllocate, onclick: () => allocateSheet() }, icon('goals'), 'Allocate leftover')
        : h('p', { class: 'muted small' }, 'You can allocate the leftover in the current month.'),
      month === current && !canAllocate ? h('p', { class: 'muted small' }, lo.leftover <= 0 ? 'Nothing to allocate: the leftover is ₹0 or below.' : 'Add a goal first.') : null,
      h('p', { class: 'muted small note-record' }, 'Allocating records goal entries in CRUX. It doesn’t move any real money: do that in your bank or investment app.')));
}

function line(label, value, op, extra) {
  return h('div', { class: 'plan-line' }, h('span', { class: 'op', 'aria-hidden': 'true' }, op === 'plus' ? '+' : op === 'minus' ? '−' : ''), h('span', { class: 'grow' }, label), h('span', { class: 'num strong' }, value), extra ?? null);
}

// ---------- allocate ----------
/** The allocate sheet: each active goal, in priority order, with an amount prefilled from its remaining plan. */
export function allocateSheet() {
  const today = todayYmd();
  const month = monthOf(today);
  const { lo } = monthFigures(month, today);
  const leftover = lo.leftover;
  const goals = state.goals.filter((g) => !g.archived).sort((a, b) => a.order - b.order);
  const pre = Object.fromEntries(prefillAllocation(goals, state.goalAdds, month, leftover).map((r) => [r.goalId, r.amount]));

  sheet('Allocate leftover', (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const summary = h('p', { class: 'alloc-summary', id: 'alloc-summary', role: 'status' });
    const rows = goals.map((g, i) => {
      const input = h('input', {
        class: 'input num alloc-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', dataset: { goal: g.id },
        value: pre[g.id] > 0 ? paiseToInput(pre[g.id]) : '', 'aria-label': `Amount for ${g.name}, in rupees`, oninput: () => { input.value = input.value.replace(/[^\d.,]/g, ''); err.textContent = ''; update(); },
      });
      const bucket = g.buckets.length ? h('select', { class: 'input alloc-bucket', 'aria-label': `Bucket for ${g.name}`, dataset: { goal: g.id } },
        h('option', { value: '' }, 'No bucket'), g.buckets.map((b) => h('option', { value: b.id }, b.name))) : null;
      const left = plannedRemaining(g, state.goalAdds, month);
      return { g, input, bucket, node: h('li', { class: 'alloc-row' },
        h('div', { class: 'alloc-top' },
          h('span', { class: 'prio', 'aria-label': `Priority ${i + 1}` }, `#${i + 1}`),
          h('span', { class: 'alloc-name' }, badge(g, 'badge badge-small'), h('span', {}, g.name)),
          h('span', { class: 'alloc-amt' }, h('span', { class: 'rupee-sm', 'aria-hidden': 'true' }, '₹'), input)),
        h('p', { class: 'muted small ind' }, g.monthlyPlan > 0 ? `Planned ${money(g.monthlyPlan)} a month · ${money(left)} still to plan this month` : 'No monthly plan: enter any amount'),
        bucket) };
    });

    const read = () => rows.map((r) => (r.input.value.trim() === '' ? 0 : parseAmount(r.input.value)));
    function update() {
      const amounts = read().map((v) => v ?? 0);
      const c = checkAllocation(amounts, leftover);
      summary.className = `alloc-summary ${c.ok ? '' : 'bad'}`;
      summary.textContent = c.ok ? `Allocating ${money(c.total)} · ${money(c.unassigned)} stays unassigned` : `Allocating ${money(c.total)} · ${money(c.over)} more than the leftover`;
    }

    const save = async () => {
      const raw = read();
      const badIdx = raw.findIndex((v) => v === null);
      if (badIdx >= 0) { err.textContent = `The amount for ${rows[badIdx].g.name} isn’t valid.`; rows[badIdx].input.focus(); return; }
      const c = checkAllocation(raw, leftover);
      if (!c.ok) { err.textContent = `That’s ${money(c.over)} more than your leftover of ${money(Math.max(0, leftover))}. Lower an amount to continue.`; return; }
      const adds = rows.map((r, i) => ({ r, amount: raw[i] })).filter((x) => x.amount > 0).map(({ r, amount }) => ({
        goalId: r.g.id, amount, date: today, note: 'Allocated from leftover', bucketId: r.bucket?.value || null,
      }));
      if (!adds.length) { err.textContent = 'Enter an amount for at least one goal.'; return; }
      const saved = await saveGoalAdds(adds);
      close();
      refresh();
      toast(`Recorded ${money(c.total)} across ${adds.length} goal${adds.length === 1 ? '' : 's'}; ${money(c.unassigned)} stays unassigned. No real money moved.`, {
        action: 'Undo', ms: 9000, onAction: async () => { await deleteGoalAdds(saved.map((a) => a.id)); refresh(); toast('Allocation undone'); },
      });
    };

    update();
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      h('div', { class: 'alloc-head' }, h('p', { class: 'muted small' }, 'Leftover this month'), h('p', { class: 'hero-amt num', id: 'alloc-leftover' }, money(leftover))),
      h('p', { class: 'note-record muted small', id: 'alloc-note' }, 'This records the allocation as goal entries in CRUX. It does not move any real money.'),
      goals.length ? h('ul', { class: 'alloc-list' }, rows.map((r) => r.node)) : h('p', { class: 'muted' }, 'Add a goal first.'),
      summary,
      err,
      h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'alloc-save' }, icon('check'), 'Save allocation'),
      h('button', { class: 'btn', type: 'button', id: 'alloc-priority', onclick: () => { close(); go('#/goals'); } }, 'Change priority order'),
      h('p', { class: 'muted small' }, 'Goals are filled from the top: the order on the Goals screen is the priority.'));
  });
}
