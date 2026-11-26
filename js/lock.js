// App lock: a PIN screen over CRUX. It hides the app from someone holding your unlocked phone; it does NOT encrypt the
// data stored on the device (the UI says so). Only a salted PBKDF2 hash of the PIN is kept, in CRUX's own database
// ("appLock" in meta); it is never part of a backup. Wrong guesses are slowed down (secure.js lockoutMs), and the
// count survives a reload. "Forgot PIN" can only erase CRUX's data: anything else would defeat the lock.
import * as db from './db.js';
import { h, icon, toast } from './ui.js';
import { hashPin, verifyPin, lockoutMs } from './secure.js';
import { eraseAll } from './store.js';

export const LOCK_AFTER = [[0, 'Immediately'], [60, 'After 1 minute'], [300, 'After 5 minutes']];
let record = null;
let fails = 0;
let until = 0;
let overlay = null;
let hiddenAt = null;

export async function loadLock() {
  record = (await db.getMeta('appLock')) ?? null;
  const f = (await db.getMeta('lockFails')) ?? {};
  fails = f.fails ?? 0;
  until = f.until ?? 0;
  return record;
}
export const lockEnabled = () => !!record;
export const lockAfter = () => record?.after ?? 0;
export const lockAfterLabel = () => (LOCK_AFTER.find(([s]) => s === lockAfter())?.[1] ?? 'Immediately').toLowerCase();
export const isLocked = () => !!overlay;

export async function enableLock(pin, after = 0) {
  record = { ...(await hashPin(pin)), after };
  await db.setMeta('appLock', record);
}
export async function setLockAfter(after) {
  record = { ...record, after };
  await db.setMeta('appLock', record);
}
export async function disableLock() {
  record = null;
  await db.setMeta('appLock', null);
  await db.setMeta('lockFails', null);
  fails = 0;
  until = 0;
}
export const checkPin = (pin) => verifyPin(pin, record);

const setInert = (on) => {
  for (const el of [document.getElementById('view'), document.querySelector('.tabbar'), document.getElementById('toasts'), document.getElementById('update-banner')]) if (el) el.inert = on;
};

/** Cover the app with the PIN screen (no-op if the lock is off or already showing). */
export function showLock() {
  if (!record || overlay) return;
  document.querySelectorAll('.sheet-back').forEach((s) => s.remove()); // an open sheet might be showing data
  setInert(true);
  let entry = '';
  let timer = null;
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' });
  const status = h('p', { class: 'lock-status', id: 'lock-status', role: 'alert' });
  const inner = h('div', { class: 'lock-inner' });
  overlay = h('div', { class: 'lock', id: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'CRUX is locked' }, inner);

  const drawDots = () => dots.replaceChildren(...Array.from({ length: record.len }, (_, i) => h('span', { class: `pin-dot${i < entry.length ? ' on' : ''}` })));
  const waiting = () => Date.now() < until;
  const tick = () => {
    clearInterval(timer);
    if (!waiting()) return;
    const show = () => {
      const s = Math.ceil((until - Date.now()) / 1000);
      status.textContent = s > 0 ? `Too many wrong PINs. Try again in ${s} s.` : '';
      overlay?.querySelectorAll('.key').forEach((k) => { k.disabled = s > 0 && !k.classList.contains('key-text'); });
      if (s <= 0) clearInterval(timer);
    };
    show();
    timer = setInterval(show, 1000);
  };

  async function attempt() {
    const tryPin = entry;
    entry = '';
    if (await verifyPin(tryPin, record)) {
      fails = 0;
      until = 0;
      await db.setMeta('lockFails', null);
      unlock();
      return;
    }
    fails += 1;
    until = Date.now() + lockoutMs(fails);
    await db.setMeta('lockFails', { fails, until });
    drawDots();
    overlay.classList.remove('shake');
    void overlay.offsetWidth; // restart the animation
    overlay.classList.add('shake');
    if (waiting()) tick();
    else status.textContent = fails < 4 ? 'Wrong PIN. Try again.' : `Wrong PIN. ${5 - fails} more ${5 - fails === 1 ? 'try' : 'tries'} before a short wait.`;
  }
  const press = (d) => {
    if (waiting()) return;
    status.textContent = '';
    if (d === 'del') entry = entry.slice(0, -1);
    else if (entry.length < record.len) entry += d;
    drawDots();
    if (entry.length === record.len) attempt();
  };
  const onKey = (e) => {
    if (!overlay || overlay.dataset.mode === 'forgot') return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  };
  function unlock() {
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
    overlay?.remove();
    overlay = null;
    setInert(false);
  }

  function drawPad() {
    overlay.dataset.mode = 'pin';
    inner.replaceChildren(
      h('span', { class: 'lock-badge', 'aria-hidden': 'true' }, icon('shield')),
      h('h1', {}, 'CRUX is locked'),
      h('p', { class: 'muted' }, 'Enter your PIN'),
      dots, status,
      h('div', { class: 'keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'forgot', '0', 'del'].map((k) => (k === 'forgot'
        ? h('button', { class: 'key key-text', type: 'button', id: 'lock-forgot', onclick: drawForgot }, 'Forgot?')
        : k === 'del'
          ? h('button', { class: 'key', type: 'button', 'aria-label': 'Delete last digit', onclick: () => press('del') }, icon('chevron-left'))
          : h('button', { class: 'key', type: 'button', 'aria-label': k, dataset: { key: k }, onclick: () => press(k) }, k)))),
      h('p', { class: 'muted small lock-note' }, 'App lock hides CRUX from anyone holding your unlocked phone. It doesn’t encrypt the data stored on this device.'));
    drawDots();
    tick();
  }

  function drawForgot() {
    overlay.dataset.mode = 'forgot';
    const confirmIn = h('input', { class: 'input', id: 'forgot-confirm', autocomplete: 'off', placeholder: 'Type ERASE', 'aria-label': 'Type ERASE to confirm' });
    const err = h('p', { class: 'form-error', role: 'alert' });
    inner.replaceChildren(
      h('span', { class: 'lock-badge warn', 'aria-hidden': 'true' }, icon('alert')),
      h('h1', {}, 'Forgot your PIN?'),
      h('p', { class: 'muted' }, 'The PIN can’t be recovered, and there is no way past it. The only option is to erase CRUX’s data on this device and start again, then restore a backup if you have one.'),
      h('p', { class: 'muted small' }, 'Only CRUX’s own data is erased; nothing else on this site is touched.'),
      confirmIn, err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', id: 'forgot-cancel', onclick: drawPad }, 'Back'),
        h('button', {
          class: 'btn btn-danger', type: 'button', id: 'forgot-erase',
          onclick: async () => {
            if (confirmIn.value.trim() !== 'ERASE') { err.textContent = 'Type ERASE in capitals to confirm.'; return; }
            await eraseAll();
            await disableLock();
            unlock();
            location.hash = '#/plan';
            toast('CRUX was erased and the lock removed. Restore a backup in Settings, or start again in Plan.', { ms: 8000 });
          },
        }, 'Erase CRUX data')));
    confirmIn.focus();
  }

  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  drawPad();
}

/** Lock again after the chosen time in the background; with "Immediately", cover the app before the system snapshot. */
export function watchLock() {
  document.addEventListener('visibilitychange', () => {
    if (!record) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (lockAfter() === 0) showLock();
    } else if (hiddenAt !== null && Date.now() - hiddenAt >= lockAfter() * 1000) {
      showLock();
    }
  });
}
