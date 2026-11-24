// Settings: backup (export / import), install, updates, version, erase.
import { h, icon, toast, confirmDialog, sheet } from '../ui.js';
import { todayYmd } from '../dates.js';
import { parseBackup, backupFileName, daysSince } from '../backup.js';
import { APP_VERSION } from '../version.js';
import { state, exportData, markExported, importData, eraseAll, resetToStarter } from '../store.js';
import { SEED_CATEGORIES } from '../seed.js';
import { install, promptInstall, installHelp, isStandalone, isIOS, checkForUpdate, isPersisted, requestPersistence } from '../pwa.js';
import { go, refresh } from '../router.js';
import { pageHead } from './common.js';

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
  const ok = await confirmDialog({
    title: 'Replace all your data?',
    body: [
      `The backup from ${when} has ${r.counts.entries} expenses in ${r.counts.categories} categories.`,
      `It will replace everything here now: ${state.entries.length} expenses and ${state.categories.length} categories. This can’t be undone.`,
      state.entries.length ? 'If you’re not sure, cancel and export first.' : null,
    ].filter(Boolean),
    ok: 'Replace', danger: true,
  });
  if (!ok) return;
  await importData(r.data);
  toast(`Imported ${r.counts.entries} expenses`);
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
      h('p', { class: 'muted' }, `This deletes all ${state.entries.length} expenses, every budget and all your categories on this device, and puts back the ${SEED_CATEGORIES.length} starter categories with ₹0 budgets.`),
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
      h('p', { class: 'muted' }, `Deletes your expenses, budgets and categories, then restores the ${SEED_CATEGORIES.length} starter categories at ₹0. Export a backup first.`),
      h('button', { class: 'btn btn-ghost-danger', type: 'button', id: 'reset-btn', onclick: resetDialog }, icon('refresh'), 'Reset to starter categories')),

    h('section', { class: 'card danger-zone' },
      h('h2', {}, 'Erase everything'),
      h('p', { class: 'muted' }, 'Deletes every category, budget and expense on this device.'),
      h('button', {
        class: 'btn btn-ghost-danger', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Erase all data?', body: [`${state.entries.length} expenses and ${state.categories.length} categories will be deleted from this device.`, 'This can’t be undone. Export first if you might want them back.'], ok: 'Erase everything', danger: true });
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
