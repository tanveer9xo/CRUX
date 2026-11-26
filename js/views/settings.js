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
import { encryptBackup, isEncryptedBackup, decryptBackup, WrongPassphrase, passphraseProblem, pinProblem } from '../secure.js';
import { LOCK_AFTER, lockEnabled, lockAfter, lockAfterLabel, enableLock, setLockAfter, disableLock, checkPin, showLock, loadLock } from '../lock.js';

export const name = 'settings';
export const tab = null;
export const title = 'Settings';

/** Export a backup. With a passphrase, the file is encrypted (AES-256-GCM; see js/secure.js) and named …-encrypted.json. */
export async function doExport({ passphrase } = {}) {
  const plain = `${JSON.stringify(exportData(), null, 2)}\n`;
  const json = passphrase ? `${JSON.stringify(await encryptBackup(plain, passphrase), null, 2)}\n` : plain;
  const name = passphrase ? backupFileName(todayYmd()).replace(/\.json$/, '-encrypted.json') : backupFileName(todayYmd());
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
  toast(`Exported ${state.entries.length} expenses${passphrase ? ', encrypted' : ''}`);
  return true;
}

/** Ask for a new passphrase (twice) and export an encrypted backup. */
function encryptedExportSheet() {
  sheet('Export encrypted', (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const p1 = h('input', { class: 'input', type: 'password', id: 'enc-pass', autocomplete: 'new-password', placeholder: 'Passphrase (8+ characters)', 'aria-label': 'Passphrase', autofocus: true });
    const p2 = h('input', { class: 'input', type: 'password', id: 'enc-pass2', autocomplete: 'new-password', placeholder: 'Type it again', 'aria-label': 'Passphrase again' });
    const go = h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'enc-save' }, icon('download'), 'Encrypt and export');
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const bad = passphraseProblem(p1.value);
      if (bad) { err.textContent = bad; p1.focus(); return; }
      if (p1.value !== p2.value) { err.textContent = 'The two passphrases don’t match.'; p2.focus(); return; }
      go.disabled = true;
      go.lastChild.textContent = 'Encrypting…';
      try {
        if (await doExport({ passphrase: p1.value })) { close(); refresh(); } else { go.disabled = false; go.lastChild.textContent = 'Encrypt and export'; }
      } catch (ex) { err.textContent = `Export failed: ${ex.message}`; go.disabled = false; go.lastChild.textContent = 'Encrypt and export'; }
    } },
    h('p', { class: 'muted' }, 'The file is encrypted with your passphrase (AES-256). Anyone who finds the file can’t read it without the passphrase.'),
    h('p', { class: 'note-record muted small' }, 'Write the passphrase down somewhere safe. If it’s lost, the backup can’t be opened, by you or anyone else.'),
    p1, p2, err, go);
  });
}

/** Ask for the passphrase of an encrypted backup. Resolves to the decrypted text, or null if cancelled. */
function askPassphrase(text) {
  return new Promise((resolve) => {
    let done = false;
    sheet('Encrypted backup', (close) => {
      const err = h('p', { class: 'form-error', role: 'alert', id: 'dec-error' });
      const pass = h('input', { class: 'input', type: 'password', id: 'dec-pass', autocomplete: 'current-password', placeholder: 'Passphrase', 'aria-label': 'Passphrase', autofocus: true });
      const go = h('button', { class: 'btn btn-primary btn-big', type: 'submit', id: 'dec-open' }, 'Open backup');
      return h('form', { class: 'sheet-body', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        go.disabled = true;
        go.textContent = 'Opening…';
        try {
          const plain = await decryptBackup(text, pass.value);
          done = true;
          close();
          resolve(plain);
        } catch (ex) {
          err.textContent = ex instanceof WrongPassphrase ? 'That passphrase doesn’t open this file. Nothing was changed.' : `${ex.message} Nothing was changed.`;
          go.disabled = false;
          go.textContent = 'Open backup';
          pass.select();
        }
      } },
      h('p', { class: 'muted' }, 'This backup is encrypted. Enter its passphrase to see what’s in it; nothing is replaced until you confirm.'),
      pass, err, go);
    }, { onClose: () => { if (!done) resolve(null); } });
  });
}

// ---------- app lock ----------
function pinSheet(mode) {
  // mode: 'set' (turn on), 'change', 'off'
  const titles = { set: 'Turn on app lock', change: 'Change PIN', off: 'Turn off app lock' };
  let after = lockAfter();
  sheet(titles[mode], (close) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const pinInput = (id, label) => h('input', { class: 'input num pin-input', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '8', autocomplete: 'off', id, 'aria-label': label, placeholder: label });
    const cur = mode === 'set' ? null : pinInput('pin-current', 'Current PIN');
    const p1 = mode === 'off' ? null : pinInput('pin-new', mode === 'change' ? 'New PIN (4–8 digits)' : 'PIN (4–8 digits)');
    const p2 = mode === 'off' ? null : pinInput('pin-new2', 'Type the PIN again');
    (cur ?? p1).setAttribute('autofocus', '');
    const afterSeg = mode === 'off' ? null : h('div', { class: 'segmented seg-lock', role: 'radiogroup', 'aria-label': 'Lock' });
    const drawAfter = () => afterSeg?.replaceChildren(...LOCK_AFTER.map(([s, label]) => h('button', {
      class: 'seg', type: 'button', role: 'radio', id: `lock-after-${s}`, 'aria-checked': String(after === s), onclick: () => { after = s; drawAfter(); },
    }, label.replace('After ', ''))));
    drawAfter();
    return h('form', { class: 'sheet-body', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (cur && !(await checkPin(cur.value))) { err.textContent = 'That isn’t your current PIN.'; cur.select(); return; }
      if (mode === 'off') { await disableLock(); close(); refresh(); toast('App lock is off'); return; }
      const bad = pinProblem(p1.value);
      if (bad) { err.textContent = bad; p1.focus(); return; }
      if (p1.value !== p2.value) { err.textContent = 'The two PINs don’t match.'; p2.focus(); return; }
      await enableLock(p1.value, after);
      close();
      refresh();
      toast(mode === 'set' ? 'App lock is on' : 'PIN changed');
    } },
    mode === 'off' ? h('p', { class: 'muted' }, 'Enter your PIN to turn the lock off.') : h('p', { class: 'muted' }, 'You’ll enter this PIN to open CRUX. It can’t be recovered: if you forget it, the only way back in is to erase CRUX’s data.'),
    cur, p1, p2,
    afterSeg ? [h('span', { class: 'field-label' }, 'Lock'), afterSeg, h('p', { class: 'muted small' }, 'How long CRUX can stay in the background before it asks for the PIN again.')] : null,
    err,
    h('button', { class: `btn ${mode === 'off' ? 'btn-danger' : 'btn-primary'} btn-big`, type: 'submit', id: 'pin-save' }, mode === 'off' ? 'Turn off' : mode === 'set' ? 'Turn on' : 'Save'));
  });
}

async function doImport(fileInput) {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  if (file.size > 20_000_000) { toast('That file is too big to be a CRUX backup'); return; }
  let text = await file.text();
  if (isEncryptedBackup(text)) {
    text = await askPassphrase(text);
    if (text === null) return; // cancelled: nothing changed
  }
  const r = parseBackup(text);
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
              await loadLock(); // the lock (a device setting) survives a reset
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
      h('button', { class: 'btn btn-wide', type: 'button', id: 'export-encrypted', onclick: encryptedExportSheet }, icon('shield'), 'Export encrypted'),
      h('p', { class: 'muted small' }, 'Import shows what’s in the file and asks before replacing anything. Encrypted backups ask for their passphrase first.'),
      fileInput),

    h('section', { class: 'card', 'aria-labelledby': 'h-security' },
      h('h2', { id: 'h-security' }, 'Security'),
      h('div', { class: 'setting-row' },
        h('div', { class: 'grow' }, h('p', { class: 'strong' }, 'App lock'), h('p', { class: 'muted small', id: 'lock-state' }, lockEnabled() ? `On · asks for the PIN ${lockAfter() ? lockAfterLabel() : 'every time you open CRUX'}` : 'Off')),
        lockEnabled() ? null : h('button', { class: 'btn btn-small btn-primary', type: 'button', id: 'lock-set', onclick: () => pinSheet('set') }, 'Set a PIN')),
      lockEnabled() ? h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-small', type: 'button', id: 'lock-now', onclick: showLock }, 'Lock now'),
        h('button', { class: 'btn btn-small', type: 'button', id: 'lock-change', onclick: () => pinSheet('change') }, 'Change PIN'),
        h('button', { class: 'btn btn-small btn-ghost-danger', type: 'button', id: 'lock-off', onclick: () => pinSheet('off') }, 'Turn off')) : null,
      h('p', { class: 'muted small' }, 'App lock hides CRUX from anyone holding your unlocked phone. It doesn’t encrypt the data stored on this device; for files you keep elsewhere, use Export encrypted.'),
      storageNote),

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
          const ok = await confirmDialog({ title: 'Erase all data?', body: [`${state.entries.length} expenses, ${state.categories.length} categories, ${state.goals.length} goals (${state.goalAdds.length} entries), ${state.bills.length} bills, ${state.income.length} income entries and ${state.incomeSources.length} recurring income sources will be deleted from this device.`, 'Only CRUX’s own data is deleted. This can’t be undone. Export first if you might want them back.', lockEnabled() ? 'App lock will be turned off too.' : null].filter(Boolean), ok: 'Erase everything', danger: true });
          if (!ok) return;
          await eraseAll();
          await loadLock(); // erase also turns the app lock off
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
