// Appearance: dark (the default), light, or follow the system. Stored under "crux-theme" (CRUX-only key on the
// shared origin). js/boot.js applies the same rule before first paint, so there's no flash.
export const THEME_KEY = 'crux-theme';
export const THEME_PREFS = ['dark', 'light', 'system'];
const COLOR = { dark: '#0E1116', light: '#F6F7F9' };

export function getThemePref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEME_PREFS.includes(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

/** The theme actually shown for a preference. Pure: tests/theme.test.js. */
export const resolveTheme = (pref, systemPrefersLight) => (pref === 'system' ? (systemPrefersLight ? 'light' : 'dark') : pref === 'light' ? 'light' : 'dark');

const prefersLight = () => !!window.matchMedia?.('(prefers-color-scheme: light)').matches;

export function applyTheme(pref = getThemePref()) {
  const theme = resolveTheme(pref, prefersLight());
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePref = pref;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR[theme]);
  return theme;
}

export function setThemePref(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* storage blocked: still applies for this visit */ }
  return applyTheme(pref);
}

/** Re-apply when the system theme changes while following it; `onChange` redraws (chip colours depend on theme). */
export function watchSystemTheme(onChange) {
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (getThemePref() !== 'system') return;
    applyTheme('system');
    onChange();
  });
}
