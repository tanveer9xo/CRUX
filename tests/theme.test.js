import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTheme, THEME_KEY, THEME_PREFS } from '../js/theme.js';

test('appearance: dark by default, light, or follow the system', () => {
  assert.deepEqual(THEME_PREFS, ['dark', 'light', 'system']);
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), 'dark');
  assert.equal(resolveTheme(undefined, true), 'dark');
  assert.equal(resolveTheme('neon', true), 'dark');
});

test('the theme preference is stored under a crux key, and boot.js applies the same rule before first paint', () => {
  assert.ok(THEME_KEY.startsWith('crux'));
  const boot = readFileSync(new URL('../js/boot.js', import.meta.url), 'utf8');
  assert.match(boot, /localStorage\.getItem\('crux-theme'\)/);
  assert.match(boot, /pref === 'system' && window\.matchMedia/);
  assert.match(boot, /\|\| 'dark'/);
});

test('the Content-Security-Policy is unchanged: no inline script, styles or external hosts', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">/);
  assert.doesNotMatch(html, /<script>|<style|style="/);
  assert.doesNotMatch(readFileSync(new URL('../css/app.css', import.meta.url), 'utf8'), /@import|url\(\s*['"]?https?:/);
});
