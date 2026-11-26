// Goals: savings and investments. Money added here is kept apart from expenses and never counts as spending.
import { h, icon, sheet, toast, confirmDialog, badge, chipStyle } from '../ui.js';
import { iconAndColor } from './picker.js';
import { parseAmount, paiseToInput, formatINR } from '../money.js';
import { todayYmd, monthOf, isYmd, longDate, dayLabel, monthLabel } from '../dates.js';
import { goalSummary, savedInMonth, maxWithdrawal } from '../goals.js';
import { COLORS, GOAL_STARTERS } from '../seed.js';
import { state, saveGoal, saveGoalAdd, deleteGoalAdd, restoreGoalAdd, goalById, uid, moveGoal, periods } from '../store.js';
import { unitWord } from './cyclesui.js';
import { go, refresh } from '../router.js';
import { pageHead, emptyState, menuButton } from './common.js';

export const name = 'goals';
export const tab = 'goals';
export const title = 'Goals';

const money = (v, opts) => formatINR(v, { decimals: 'auto', ...opts });

// ---------- list ----------
export function render() {
  const today = todayYmd();
  const active = state.goals.filter((g) => !g.archived);
  const archived = state.goals.filter((g) => g.archived);
  const per = periods().current();
  const saved = savedInMonth(state.goalAdds, per);
  return h('div', { class: 'page goals' },
    pageHead('Goals'),
    h('p', { class: 'saved-line' }, h('span', { class: 'muted' }, `Saved this ${unitWord()} (${per.kind === 'cycle' ? per.range : monthLabel(per.key)}): `), h('strong', { class: 'num', id: 'saved-this-month' }, money(saved)),
      h('span', { class: 'muted small' }, ' · not counted as spending')),
    active.length > 1 ? h('p', { class: 'muted small lede' }, 'Priority is the order below: “Allocate leftover” fills the top goal first. Use the arrows to reorder.') : null,
    active.length ? h('ul', { class: 'goal-list' }, active.map((g, i) => h('li', {}, goalCard(g, today, i, active.length)))) : emptyState('No goals yet', 'Add one for an emergency fund, a trip, investments…', null, 'target'),
    h('button', { class: 'btn btn-wide', type: 'button', id: 'new-goal', onclick: newGoalPicker }, icon('plus'), 'New goal'),
    archived.length ? h('details', { class: 'archived' },
      h('summary', {}, `Archived (${archived.length})`),
      h('ul', { class: 'plain-list' }, archived.map((g) => h('li', { class: 'plain-row' }, badge(g), h('span', { class: 'grow' }, g.name),
        h('button', { class: 'btn btn-small', type: 'button', onclick: async () => { await saveGoal({ ...g, archived: false }); refresh(); toast(`${g.name} is back`); } }, 'Restore'))))) : null);
}

/** The numbers for one goal: used on the card and on the detail page. */
function goalFigures(g, s, today) {
  const rows = [];
  rows.push(h('p', { class: 'goal-saved num' }, money(s.saved)));
  if (s.targeted) {
    rows.push(h('p', { class: 'muted' }, 'of ', h('span', { class: 'num strong' }, money(s.target)), ` · ${s.pct}%`));
    rows.push(h('div', { class: `bar ${s.reached ? 'bar-done' : ''}` }, h('div', { class: 'bar-fill', style: { width: `${Math.min(100, s.pct)}%` } })));
    rows.push(h('p', { class: s.reached ? 'goal-line done' : 'goal-line' }, s.reached ? 'Target reached' : [h('span', { class: 'num strong' }, money(s.remaining)), ' to go']));
  } else {
    rows.push(h('p', { class: 'muted' }, 'No target set'));
  }
  const m = s.month;
  rows.push(h('p', { class: 'goal-line' }, `This ${unitWord()}: `, h('span', { class: 'num strong' }, money(m.added, { sign: true })),
    m.plan ? [' of ', h('span', { class: 'num' }, money(m.plan)), ` planned · ${m.pct}%`] : h('span', { class: 'muted' }, ' · no monthly plan')));
  if (m.plan) rows.push(h('div', { class: 'bar bar-thin' }, h('div', { class: 'bar-fill', style: { width: `${Math.min(100, m.pct)}%` } })));
  const n = s.needed;
  if (n?.state === 'ok') rows.push(h('p', { class: 'goal-line' }, 'Needs ', h('span', { class: 'num strong' }, money(n.perMonth)), ` a month to reach it by ${longDate(g.targetDate)} (${n.monthsLeft} month${n.monthsLeft === 1 ? '' : 's'})`));
  else if (n?.state === 'past') rows.push(h('p', { class: 'goal-line late' }, icon('alert', 'ic ic-inline'), `Target date ${longDate(g.targetDate)} has passed`));
  else if (n?.state === 'done') rows.push(h('p', { class: 'goal-line done' }, `Reached before ${longDate(g.targetDate)}`));
  else if (s.targeted && !g.targetDate) rows.push(h('p', { class: 'muted small' }, 'Add a target date to see the monthly amount needed.'));
  if (s.buckets.length) rows.push(bucketBlock(s.buckets));
  return rows;
}

function bucketBlock(split) {
  const total = split.reduce((a, r) => a + Math.max(0, r.amount), 0);
  const bar = total > 0 ? h('div', { class: 'split-bar', role: 'img', 'aria-label': `Split: ${split.map((r) => `${r.name} ${money(r.amount)}`).join(', ')}` },
    split.filter((r) => r.amount > 0).map((r) => h('span', { class: 'split-seg', style: { width: `${(r.amount * 100) / total}%`, '--c': COLORS[split.indexOf(r) % COLORS.length] } }))) : null;
  return h('div', { class: 'split' }, h('p', { class: 'muted small' }, 'Where it sits'), bar,
    h('ul', { class: 'split-list' }, split.map((r, i) => h('li', {},
      h('span', { class: 'dot', style: { '--c': COLORS[i % COLORS.length] }, 'aria-hidden': 'true' }),
      h('span', { class: 'grow' }, r.name),
      h('span', { class: 'num' }, money(r.amount)),
      h('span', { class: 'num muted small share' }, r.share === null ? '' : `${r.share}%`)))));
}

function goalCard(g, today, i, n) {
  const s = goalSummary(g, state.goalAdds, today, periods().current());
  return h('article', { class: 'card goal-card', 'aria-label': g.name },
    h('div', { class: 'goal-head' },
      h('button', { class: 'goal-title', type: 'button', onclick: () => go(`#/goal/${g.id}`), 'aria-label': `${g.name}: open history` }, badge(g), h('span', {}, g.name)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Edit ${g.name}`, onclick: () => goalSheet(g) }, icon('edit'))),
    n > 1 ? h('div', { class: 'goal-prio' },
      h('span', { class: 'prio', 'aria-label': `Priority ${i + 1} of ${n}` }, `#${i + 1}`),
      h('span', { class: 'muted small grow' }, i === 0 ? 'Top priority' : 'Priority'),
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'aria-label': `Raise priority of ${g.name}`, disabled: i === 0, onclick: async () => { await moveGoal(g.id, -1); refresh(); } }, icon('up')),
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'aria-label': `Lower priority of ${g.name}`, disabled: i === n - 1, onclick: async () => { await moveGoal(g.id, 1); refresh(); } }, icon('down'))) : null,
    ...goalFigures(g, s, today),
    h('div', { class: 'btn-row goal-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => moneySheet(g, { mode: 'add' }) }, icon('plus'), 'Add money'),
      h('button', { class: 'btn', type: 'button', onclick: () => moneySheet(g, { mode: 'withdraw' }) }, icon('minus'), 'Withdraw')));
}

// ---------- detail ----------
export const detail = {
  name: 'goal',
  tab: 'goals',
  title: 'Goal',
  render({ params }) {
    const g = goalById(params.id);
    if (!g) return h('div', { class: 'page' }, emptyState('This goal no longer exists', null, h('a', { class: 'btn', href: '#/goals' }, 'Goals')));
    const today = todayYmd();
    const s = goalSummary(g, state.goalAdds, today, periods().current());
    const adds = state.goalAdds.filter((a) => a.goalId === g.id);
    const bucketName = (id) => g.buckets.find((b) => b.id === id)?.name;
    return h('div', { class: 'page goal-detail' },
      h('header', { class: 'page-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back to Goals', onclick: () => go('#/goals') }, icon('left')),
        h('h1', {}, badge(g, 'badge badge-small'), h('span', {}, g.name)),
        h('div', { class: 'head-actions' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Edit goal', onclick: () => goalSheet(g) }, icon('edit')), menuButton())),
      h('section', { class: 'card goal-card' },
        ...goalFigures(g, s, today),
        h('div', { class: 'btn-row goal-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => moneySheet(g, { mode: 'add' }) }, icon('plus'), 'Add money'),
          h('button', { class: 'btn', type: 'button', onclick: () => moneySheet(g, { mode: 'withdraw' }) }, icon('minus'), 'Withdraw'))),
      h('h2', {}, `Entries (${adds.length})`),
      adds.length ? h('ul', { class: 'entry-list' }, adds.map((a) => h('li', {},
        h('button', { class: 'entry', type: 'button', onclick: () => moneySheet(g, { existing: a }), 'aria-label': `${a.amount < 0 ? 'Withdrawal' : 'Added'} ${money(Math.abs(a.amount))}, ${dayLabel(a.date)}. Edit` },
          h('span', { class: 'badge', style: chipStyle(a.amount < 0 ? '#C9A24B' : '#4FAF86'), 'aria-hidden': 'true' }, icon(a.amount < 0 ? 'minus' : 'plus')),
          h('span', { class: 'entry-text' }, h('span', { class: 'entry-cat' }, a.amount < 0 ? 'Withdrawal' : 'Added'),
            h('span', { class: 'entry-note' }, [dayLabel(a.date), bucketName(a.bucketId), a.note].filter(Boolean).join(' · '))),
          h('span', { class: 'entry-amt num' }, money(a.amount, { sign: true })))))) : emptyState('Nothing added yet', 'Use Add money to log the first one.'));
  },
};

// ---------- add / withdraw ----------
export function moneySheet(goal, { existing = null, mode = 'add' } = {}) {
  let withdraw = existing ? existing.amount < 0 : mode === 'withdraw';
  let bucketId = existing?.bucketId ?? null;
  sheet(goal.name, (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const amountIn = h('input', {
      class: 'input amount-small num', id: 'gm-amount', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', autofocus: true,
      value: existing ? paiseToInput(Math.abs(existing.amount)) : '', 'aria-label': 'Amount in rupees',
      oninput: () => { amountIn.value = amountIn.value.replace(/[^\d.,]/g, ''); err.textContent = ''; },
    });
    const dateIn = h('input', { class: 'input', id: 'gm-date', type: 'date', value: existing?.date ?? todayYmd(), 'aria-label': 'Date' });
    const noteIn = h('input', { class: 'input', id: 'gm-note', type: 'text', maxlength: '200', placeholder: 'Note (optional)', value: existing?.note ?? '', enterkeyhint: 'done' });

    const seg = h('div', { class: 'segmented seg2', role: 'radiogroup', 'aria-label': 'Add or withdraw' });
    const buckets = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Bucket' });
    const draw = () => {
      seg.replaceChildren(...[['add', 'Add'], ['withdraw', 'Withdraw']].map(([k, label]) => h('button', {
        class: 'seg', type: 'button', role: 'radio', id: `gm-${k}`, 'aria-checked': String((k === 'withdraw') === withdraw),
        onclick: () => { withdraw = k === 'withdraw'; err.textContent = ''; draw(); },
      }, label)));
      if (!goal.buckets.length) return;
      const opts = [{ id: null, name: 'No bucket' }, ...goal.buckets];
      buckets.replaceChildren(...opts.map((b) => h('button', {
        class: 'chip chip-small', type: 'button', role: 'radio', 'aria-checked': String(b.id === bucketId), dataset: { bucket: b.id ?? '' },
        onclick: () => { bucketId = b.id; err.textContent = ''; draw(); },
      }, b.name, withdraw ? h('span', { class: 'muted small' }, ` · ${money(maxWithdrawal(state.goalAdds, goal.id, b.id, existing?.id))}`) : null)));
    };
    draw();

    const save = async () => {
      const paise = parseAmount(amountIn.value);
      if (!paise) { err.textContent = 'Enter an amount above ₹0.'; amountIn.focus(); return; }
      if (!isYmd(dateIn.value)) { err.textContent = 'Pick a date.'; return; }
      if (withdraw) {
        const max = maxWithdrawal(state.goalAdds, goal.id, bucketId, existing?.id);
        if (paise > max) {
          err.textContent = goal.buckets.length && bucketId === null
            ? `Pick the bucket to withdraw from (${money(max)} is outside any bucket).`
            : `There’s only ${money(max)} ${bucketId ? 'in this bucket' : 'to withdraw'}.`;
          return;
        }
      }
      await saveGoalAdd({ id: existing?.id, createdAt: existing?.createdAt, goalId: goal.id, amount: withdraw ? -paise : paise, date: dateIn.value, note: noteIn.value.trim().slice(0, 200), bucketId });
      close();
      refresh();
      toast(`${withdraw ? 'Withdrew' : 'Added'} ${money(paise)} ${withdraw ? 'from' : 'to'} ${goal.name}`);
    };

    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      seg,
      h('label', { class: 'amount-wrap amount-wrap-small', for: 'gm-amount' }, h('span', { class: 'rupee', 'aria-hidden': 'true' }, '₹'), amountIn),
      err,
      goal.buckets.length ? buckets : null,
      h('div', { class: 'field-row' }, dateIn),
      noteIn,
      h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'gm-save' }, icon('check'), 'Save'),
      existing ? h('button', {
        class: 'btn btn-ghost-danger', type: 'button',
        onclick: async () => {
          const gone = await deleteGoalAdd(existing.id);
          close();
          refresh();
          toast(`Deleted ${money(Math.abs(gone.amount))}`, { action: 'Undo', onAction: async () => { await restoreGoalAdd(gone); refresh(); toast('Restored'); } });
        },
      }, icon('trash'), 'Delete this entry') : null);
  });
}

// ---------- new goal: pick a starter, or Custom ----------
/** Suggested goals (none is created until you pick one and save). Custom starts blank. */
export function newGoalPicker() {
  sheet('New goal', (close) => h('div', { class: 'sheet-body' },
    h('p', { class: 'muted small' }, 'Pick a starting point. You can change the name, target and date next.'),
    h('ul', { class: 'starter-list', 'aria-label': 'Suggested goals' }, GOAL_STARTERS.map((s) => {
      const taken = !s.custom && state.goals.some((g) => !g.archived && g.name.toLowerCase() === s.name.toLowerCase());
      return h('li', {}, h('button', {
        class: 'starter', type: 'button', disabled: taken, dataset: { starter: s.name },
        onclick: () => { close(); goalSheet(null, { preset: s }); },
      }, badge(s), h('span', { class: 'grow' }, s.name), taken ? h('span', { class: 'muted small' }, 'Added') : icon('right')));
    }))));
}

// ---------- add / edit a goal ----------
export function goalSheet(goal, { preset = null } = {}) {
  const named = preset && !preset.custom;
  sheet(goal ? 'Edit goal' : 'New goal', (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const nameIn = h('input', { class: 'input', id: 'goal-name', maxlength: '40', value: goal?.name ?? (named ? preset.name : ''), placeholder: 'e.g. Emergency fund', autofocus: !named, autocomplete: 'off' });
    const look = iconAndColor({ icon: goal?.icon ?? preset?.icon ?? 'target', color: goal?.color ?? preset?.color ?? COLORS[state.goals.length % COLORS.length] });
    const targetIn = h('input', { class: 'input num', id: 'goal-target', inputmode: 'decimal', autocomplete: 'off', placeholder: 'No target', autofocus: named, value: goal && goal.target > 0 ? paiseToInput(goal.target) : '' });
    const dateIn = h('input', { class: 'input', id: 'goal-date', type: 'date', value: goal?.targetDate ?? '', 'aria-label': 'Target date (optional)' });
    const planIn = h('input', { class: 'input num', id: 'goal-plan', inputmode: 'decimal', autocomplete: 'off', placeholder: 'None', value: goal && goal.monthlyPlan > 0 ? paiseToInput(goal.monthlyPlan) : '' });

    const rows = (goal?.buckets ?? []).map((b) => ({ ...b }));
    const used = (id) => !!goal && state.goalAdds.some((a) => a.goalId === goal.id && a.bucketId === id);
    const list = h('div', { class: 'bucket-edit' });
    const drawBuckets = () => list.replaceChildren(...rows.map((b, i) => h('div', { class: 'bucket-row' },
      h('input', { class: 'input', value: b.name, maxlength: '40', placeholder: 'e.g. FD', 'aria-label': `Bucket ${i + 1} name`, oninput: (e) => { b.name = e.target.value; } }),
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': `Remove bucket ${b.name || i + 1}`, disabled: used(b.id), title: used(b.id) ? 'It has money in it' : undefined,
        onclick: () => { rows.splice(i, 1); drawBuckets(); },
      }, icon('x')))));
    drawBuckets();

    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);

    const save = async () => {
      const nm = nameIn.value.trim();
      if (!nm) { err.textContent = 'Give it a name.'; nameIn.focus(); return; }
      if (state.goals.some((g) => g.id !== goal?.id && !g.archived && g.name.toLowerCase() === nm.toLowerCase())) { err.textContent = 'There’s already a goal with that name.'; return; }
      const target = targetIn.value.trim() === '' ? 0 : parseAmount(targetIn.value);
      const plan = planIn.value.trim() === '' ? 0 : parseAmount(planIn.value);
      if (target === null || plan === null) { err.textContent = 'An amount isn’t valid.'; return; }
      if (dateIn.value && !isYmd(dateIn.value)) { err.textContent = 'The target date isn’t valid.'; return; }
      const buckets = [];
      for (const b of rows) {
        const bn = b.name.trim();
        if (!bn) { if (used(b.id)) { err.textContent = 'A bucket with money in it needs a name.'; return; } continue; }
        if (buckets.some((x) => x.name.toLowerCase() === bn.toLowerCase())) { err.textContent = `There are two buckets called “${bn}”.`; return; }
        buckets.push({ id: b.id, name: bn });
      }
      const { icon: iconKey, color } = look.get();
      await saveGoal({ ...goal, name: nm, icon: iconKey, color, emoji: goal?.emoji ?? '', target, targetDate: dateIn.value || null, monthlyPlan: plan, buckets, archived: goal?.archived ?? false });
      close();
      refresh();
      toast(goal ? 'Goal updated' : `${nm} added`);
    };

    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
      field('Name', nameIn),
      field('Target amount (₹, optional)', targetIn),
      field('Target date (optional)', dateIn, 'With a target and a date, CRUX shows the monthly amount needed.'),
      field('Planned per month (₹, optional)', planIn),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Buckets (optional)'),
        h('span', { class: 'muted small' }, 'Where the money sits, e.g. Savings account, FD, Liquid fund.'),
        list,
        h('button', { class: 'btn btn-small', type: 'button', id: 'add-bucket', onclick: () => { rows.push({ id: uid(), name: '' }); drawBuckets(); list.lastElementChild?.querySelector('input')?.focus(); } }, icon('plus'), 'Add a bucket')),
      look.node,
      err,
      h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'goal-save' }, goal ? 'Save' : 'Add goal'),
      goal ? h('button', {
        class: 'btn btn-ghost-danger', type: 'button', id: 'goal-archive',
        onclick: async () => {
          const n = state.goalAdds.filter((a) => a.goalId === goal.id).length;
          const ok = await confirmDialog({ title: `Archive ${goal.name}?`, body: [`It leaves the Goals list and Home. Its ${n} entr${n === 1 ? 'y' : 'ies'} and its saved total are kept, and you can restore it any time.`], ok: 'Archive', danger: true });
          if (!ok) return;
          await saveGoal({ ...goal, archived: true });
          close();
          if (location.hash.startsWith('#/goal/')) go('#/goals'); else refresh();
          toast(`${goal.name} archived`, { action: 'Undo', onAction: async () => { await saveGoal({ ...goal, archived: false }); refresh(); toast('Restored'); } });
        },
      }, icon('archive'), 'Archive goal') : null);
  });
}
