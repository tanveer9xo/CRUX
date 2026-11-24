// Service worker registration, update banner, install prompt and persistent storage.
// Same pattern as VANE: a new version installs in the background, a banner offers it, data is never touched.
import { h, icon, toast } from './ui.js';

export const install = { prompt: null, listeners: new Set() };
const notify = () => install.listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep it for our own Install button in Settings
  install.prompt = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  install.prompt = null;
  notify();
  toast('CRUX installed');
});

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  const p = install.prompt;
  if (!p) return false;
  install.prompt = null;
  p.prompt();
  const { outcome } = await p.userChoice;
  notify();
  return outcome === 'accepted';
}

let registration = null;
let reloadOnControllerChange = false;

export function showUpdateBanner(reg = registration) {
  if (!reg?.waiting || !navigator.serviceWorker.controller) return false;
  document.getElementById('update-banner')?.remove();
  const banner = h('div', { id: 'update-banner', class: 'update-banner', role: 'status' },
    h('button', {
      class: 'update-go', type: 'button',
      onclick: (e) => {
        e.currentTarget.disabled = true;
        reloadOnControllerChange = true;
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        else location.reload();
      },
    }, icon('refresh'), h('span', {}, 'Update ready. Tap to refresh')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss: update later', onclick: () => banner.remove() }, icon('x')));
  document.body.insertBefore(banner, document.getElementById('view'));
  return true;
}

/** 'ready' | 'found' | 'none' | 'unsupported' */
export async function checkForUpdate() {
  if (!registration) return 'unsupported';
  if (registration.waiting && showUpdateBanner()) return 'ready';
  try {
    await registration.update();
  } catch {
    return 'none';
  }
  if (registration.waiting && showUpdateBanner()) return 'ready';
  return registration.installing ? 'found' : 'none';
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
      });
    });
  }).catch((err) => console.warn('Service worker registration failed', err));
}

/** Ask the browser not to evict our data (Chrome decides silently; Safari grants installed apps). */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted() {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

export function installHelp() {
  if (isIOS()) return 'On iPhone: open this page in Safari, tap Share, then “Add to Home Screen”. It opens full screen from there.';
  return 'Open the browser menu and choose “Install app” or “Add to Home screen”. Chrome on Android shows an Install button here when it can.';
}
