// Settings: backup (export / import), install, updates, version, erase.
import { h, icon, toast, confirmDialog, sheet } from '../ui.js';
import { todayYmd } from '../dates.js';
import { parseBackup, backupFileName, daysSince } from '../backup.js';
import { APP_VERSION } from '../version.js';
import { state, exportData, markExported, importData, eraseAll, resetToStarter } from '../store.js';
import { SEED_CATEGORIES, SEED_GOALS } from '../seed.js';
import { install, promptInstall, installHelp, isStandalone, isIOS, checkForUpdate, isPersisted, requestPersistence } from '../pwa.js';
import { go, refresh } from '../router.js';
import { pageHead } from './common.js';
import { getThemePref, setThemePref } from '../theme.js';

export const name = 'settings';
export const tab = null;
export const title = 'Settings';

export async function doExport() {
  const json = `${JSON.stringify(exportData(), null, 2)}\n`;
  const name = backupFileName(todayYmd());
  const file = new File([json], name, { type: 'application/json' });
  // iPhone: the share sheet ("Save to Files") is the dependable way out of an installed web app.
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch (e) {
      if (e.name === 'AbortError') return false;
      throw e;
    }
  } else {
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: name, class: 'sr-only' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await markExported();
  toast(`Exported ${state.entries.length} expenses`);
  return true;
}

async function doImport(fileInput) {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  if (file.size > 20_000_000) { toast('That file is too big to be a CRUX backup'); return; }
  const r = parseBackup(await file.text());
  if (!r.ok) {
    await confirmDialog({ title: 'Can’t import this file', body: [r.error, 'Nothing was changed.'], ok: 'OK' });
    return;
  }
  const when = r.exportedAt ? new Date(r.exportedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'an unknown date';
  const c = r.counts;
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const list = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);
  const inFile = [`${n(c.entries, 'expense')} in ${n(c.categories, 'category', 'categories')}`, ...(r.hasGoalData ? [`${n(c.goals, 'goal')} with ${n(c.goalAdds, 'entry', 'entries')}`, n(c.bills, 'bill')] : []), ...(r.hasIncomeData ? [n(c.income, 'income entry', 'income entries'), n(c.incomeSources, 'recurring income source')] : [])];
  const here = [`${n(state.entries.length, 'expense')} and ${n(state.categories.length, 'category', 'categories')}`, ...(r.hasGoalData ? [`${n(state.goals.length, 'goal')} with ${n(state.goalAdds.length, 'entry', 'entries')}`, n(state.bills.length, 'bill')] : []), ...(r.hasIncomeData ? [n(state.income.length, 'income entry', 'income entries'), n(state.incomeSources.length, 'recurring income source')] : [])];
  const kept = [...(r.hasGoalData ? [] : [`${n(state.goals.length, 'goal')} (${n(state.goalAdds.length, 'entry', 'entries')})`, n(state.bills.length, 'bill')]), ...(r.hasIncomeData ? [] : [n(state.income.length, 'income entry', 'income entries'), n(state.incomeSources.length, 'recurring income source')])];
  const missing = [...(r.hasGoalData ? [] : ['goals or bills']), ...(r.hasIncomeData ? [] : ['income'])];
  const ok = await confirmDialog({
    title: 'Replace all your data?',
    body: [
      `The backup from ${when} has ${list(inFile)}.`,
      `It will replace everything here now: ${list(here)}. This can’t be undone.`,
      kept.length ? `This file is from an older version and has no ${missing.join(' or ')}, so your ${list(kept)} here are kept as they are.` : null,
      state.entries.length || state.goals.length || state.bills.length || state.income.length ? 'If you’re not sure, cancel and export first.' : null,
    ].filter(Boolean),
    ok: 'Replace', danger: true,
  });
  if (!ok) return;
  await importData(r.data, { keepGoalData: !r.hasGoalData, keepIncomeData: !r.hasIncomeData });
  toast(`Imported ${c.entries} expenses` + (r.hasGoalData ? `, ${c.goals} goals and ${c.bills} bills` : '') + (r.hasIncomeData ? `, ${c.income} income entries` : ''));
  go('#/');
}

/** Confirm a reset, with an Export button right there (a reset deletes every expense on this device). */
function resetDialog() {
  sheet('Reset to starter categories?', (close) => {
    const status = h('p', { class: 'muted small', role: 'status' });
    const exportBtn = h('button', {
      class: 'btn', type: 'button', id: 'reset-export',
      onclick: async () => {
        try { if (await doExport()) status.textContent = 'Backup saved. You can reset now.'; } catch (e) { status.textContent = `Export failed: ${e.message}`; }
      },
    }, icon('download'), 'Export a backup first');
    return h('div', { class: 'sheet-body' },
      h('p', { class: 'muted', id: 'reset-text' }, `This deletes all ${state.entries.length} expenses, every budget, all your categories, ${state.goals.length} goals (with ${state.goalAdds.length} entries), ${state.bills.length} bills, ${state.income.length} income entries and ${state.incomeSources.length} recurring income sources on this device, and puts back the ${SEED_CATEGORIES.length} starter categories with ₹0 budgets and the ${SEED_GOALS.length} starter goals with ₹0 targets.`),
      h('p', { class: 'muted' }, 'Only CRUX’s own data is deleted; nothing else on this site is touched. It can’t be undone, so export a backup first if you might want your data back.'),
      status,
      exportBtn,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', autofocus: true, onclick: close }, 'Cancel'),
        h('button', {
          class: 'btn btn-danger', type: 'button', id: 'reset-confirm',
          onclick: async () => {
            try {
              await resetToStarter();
            } catch (e) { status.textContent = `Reset failed: ${e.message}`; return; }
            close();
            toast(`Reset: ${SEED_CATEGORIES.length} starter categories, no expenses`);
            go('#/');
          },
        }, 'Reset')));
  });
}

export function render({ query }) {
  const exportedText = Number.isFinite(state.lastExport)
    ? `Last export ${daysSince(state.lastExport, Date.now()) === 0 ? 'today' : `${daysSince(state.lastExport, Date.now())} days ago`}.`
    : 'Never exported.';
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'import-file', tabindex: '-1', onchange: () => doImport(fileInput) });

  const installBox = h('div', {});
  const drawInstall = () => installBox.replaceChildren(isStandalone()
    ? h('p', { class: 'muted' }, 'Installed. CRUX opens full screen and works offline.')
    : install.prompt
      ? h('button', { class: 'btn btn-primary', type: 'button', onclick: promptInstall }, icon('download'), 'Install CRUX')
      : h('p', { class: 'muted' }, installHelp()));
  drawInstall();
  install.listeners.add(drawInstall);

  const storageNote = h('p', { class: 'muted small' }, '');
  isPersisted().then((p) => { storageNote.textContent = p ? 'Storage is protected: the browser won’t clear it to free space.' : 'Storage isn’t protected yet; it becomes protected after you add an expense or install the app.'; });

  const page = h('div', { class: 'page settings' },
    pageHead('Settings'),

    h('section', { class: 'card' },
      h('h2', {}, 'Backup'),
      h('p', { class: 'muted' }, 'Your data lives only on this device. Export a backup file now and then, and keep it somewhere safe.'),
      h('p', { class: 'strong' }, exportedText),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', id: 'export-btn', onclick: async () => { try { if (await doExport()) refresh(); } catch (e) { toast(`Export failed: ${e.message}`); } } }, icon('download'), 'Export'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, icon('upload'), 'Import')),
      h('p', { class: 'muted small' }, 'Import shows what’s in the file and asks before replacing anything.'),
      fileInput),

    h('section', { class: 'card', 'aria-labelledby': 'h-look' },
      h('h2', { id: 'h-look' }, 'Appearance'),
      h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Theme' },
        [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'System', 'monitor']].map(([k, label, ic]) => h('button', {
          class: 'seg', type: 'button', role: 'radio', id: `theme-${k}`, 'aria-checked': String(getThemePref() === k),
          onclick: () => { setThemePref(k); refresh(); },
        }, icon(ic), label))),
      h('p', { class: 'muted small' }, 'System follows your phone’s light or dark setting.')),

    h('section', { class: 'card' },
      h('h2', {}, 'App'),
      installBox,
      storageNote,
      h('div', { class: 'about' },
        h('div', {}, h('p', { class: 'wordmark' }, 'CRUX'), h('p', { class: 'muted' }, 'Version ', h('span', { class: 'num', id: 'app-version' }, APP_VERSION))),
        h('button', {
          class: 'btn btn-small', type: 'button',
          onclick: async () => {
            const r = await checkForUpdate();
            toast(r === 'ready' ? 'An update is ready: tap the banner at the top.' : r === 'found' ? 'Downloading the update…' : r === 'none' ? `You have the latest version (${APP_VERSION}).` : 'Updates need the installed app or a secure connection.');
          },
        }, icon('refresh'), 'Check for updates'))),

    h('section', { class: 'card' },
      h('h2', {}, 'Privacy'),
      h('p', { class: 'muted' }, 'No accounts, no servers, no analytics. Nothing you enter leaves this device unless you export it.')),

    h('section', { class: 'card danger-zone' },
      h('h2', {}, 'Reset to starter categories'),
      h('p', { class: 'muted' }, `Deletes your expenses, budgets, categories, goals, bills and income, then restores the ${SEED_CATEGORIES.length} starter categories at ₹0 and the ${SEED_GOALS.length} starter goals. Export a backup first.`),
      h('button', { class: 'btn btn-ghost-danger', type: 'button', id: 'reset-btn', onclick: resetDialog }, icon('refresh'), 'Reset to starter categories')),

    h('section', { class: 'card danger-zone' },
      h('h2', {}, 'Erase everything'),
      h('p', { class: 'muted' }, 'Deletes every category, budget, expense, goal, bill and income on this device, and doesn’t put anything back.'),
      h('button', {
        class: 'btn btn-ghost-danger', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Erase all data?', body: [`${state.entries.length} expenses, ${state.categories.length} categories, ${state.goals.length} goals (${state.goalAdds.length} entries), ${state.bills.length} bills, ${state.income.length} income entries and ${state.incomeSources.length} recurring income sources will be deleted from this device.`, 'Only CRUX’s own data is deleted. This can’t be undone. Export first if you might want them back.'], ok: 'Erase everything', danger: true });
          if (!ok) return;
          await eraseAll();
          toast('All data erased');
          go('#/plan');
        },
      }, icon('trash'), 'Erase all data')));

  if (query.get('export') === '1') {
    page.querySelector('#export-btn').classList.add('pulse');
  }
  if (state.entries.length) requestPersistence();
  return page;
}
