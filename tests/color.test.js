import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, luminance, mix, chipColors, CHIP_SURFACE } from '../js/color.js';
import { COLORS, SEED_GOALS, GOAL_STARTERS } from '../js/seed.js';
import { BILL_TYPES } from '../js/bills.js';

// The colours of 1.0.x–1.2.x installs. Existing users keep them; chips must still be legible.
const LEGACY = ['#3987E5', '#D95926', '#7C8796', '#199E70', '#9085E9', '#D55181', '#0CA30C', '#C98500', '#E66767', '#4FB6D9', '#B06BD8', '#5C6FE0', '#A47C48', '#D8C23A', '#6BD39B', '#F08FB6', '#8E6C5A', '#A0B94A'];

test('contrast maths matches WCAG reference values', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF') * 10) / 10, 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrast('#767676', '#FFFFFF') - 4.54) < 0.01);
  assert.equal(luminance('#FFFFFF'), 1);
  assert.equal(mix('#FFFFFF', '#000000', 0.5), '#808080');
});

test('every chip colour (new palette, goals, bill types and every legacy colour) reaches 3:1 in both themes', () => {
  const all = [...COLORS, ...SEED_GOALS.map((g) => g.color), ...GOAL_STARTERS.map((g) => g.color), ...BILL_TYPES.map((t) => t.color), ...LEGACY];
  for (const theme of ['dark', 'light']) {
    for (const c of all) {
      const { bg, fg } = chipColors(c, theme);
      assert.ok(contrast(fg, bg) >= 3, `${c} in ${theme}: ${contrast(fg, bg).toFixed(2)}`);
      assert.ok(contrast(bg, CHIP_SURFACE[theme]) < 1.5, `${c} tint should stay muted in ${theme}`);
    }
  }
});

test('legacy colours are only softened where contrast requires it (and never stored)', () => {
  // A colour that already passes on its tint is drawn exactly as stored.
  for (const theme of ['dark', 'light']) for (const c of LEGACY) {
    const { bg, fg } = chipColors(c, theme);
    if (contrast(c, bg) >= 3) assert.equal(fg, c, `${c} in ${theme} should be untouched`);
  }
});

test('the new palette keeps neighbouring colours clearly apart', () => {
  // Adjacent swatches (and adjacent categories in the seed order) must not look alike.
  const dist = (a, b) => { const p = [a, b].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))); return Math.hypot(...p[0].map((x, i) => x - p[1][i])); };
  for (let i = 1; i < COLORS.length; i++) assert.ok(dist(COLORS[i], COLORS[i - 1]) > 60, `${COLORS[i - 1]} and ${COLORS[i]} are too close`);
  assert.equal(new Set(COLORS).size, COLORS.length);
});

// ---- design tokens, read from the stylesheet ----
function tokens(css, selector) {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}
const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
const THEMES = { dark: tokens(css, ':root {'), light: { ...tokens(css, ':root {'), ...tokens(css, ':root[data-theme="light"] {') } };

test('both themes define the semantic colour tokens', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const k of ['bg', 'surface-1', 'surface-2', 'surface-3', 'text-1', 'text-2', 'text-3', 'accent', 'on-accent', 'success', 'warning', 'danger', 'info']) assert.ok(t[k], `${name} is missing --${k}`);
  }
  assert.equal(THEMES.dark['surface-2'].toUpperCase(), CHIP_SURFACE.dark.toUpperCase(), 'chip surface (dark) matches --surface-2');
  assert.equal(THEMES.light['surface-2'].toUpperCase(), CHIP_SURFACE.light.toUpperCase(), 'chip surface (light) matches --surface-2');
});

test('text and status colours meet WCAG AA (4.5:1) on every surface, in both themes', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const surface of ['bg', 'surface-1', 'surface-2']) {
      for (const fg of ['text-1', 'text-2', 'text-3', 'accent', 'success', 'warning', 'danger', 'info']) {
        const c = contrast(t[fg], t[surface]);
        assert.ok(c >= 4.5, `${name}: --${fg} on --${surface} is ${c.toFixed(2)}`);
      }
    }
    assert.ok(contrast(t['on-accent'], t.accent) >= 4.5, `${name}: text on the accent button`);
    assert.ok(contrast(t['on-danger'] ?? t['on-accent'], t.danger) >= 4.5, `${name}: text on the danger button`);
  }
});

test('progress bars (accent, amber, red) stand out from their track by 3:1 in both themes', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const fill of ['accent', 'warning', 'danger']) assert.ok(contrast(t[fill], t['surface-3']) >= 3 || contrast(t[fill], t['surface-1']) >= 3, `${name}: ${fill} bar`);
    // Amber and red differ by hue (the bars and the warning texts also carry words and an icon).
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [a, b] = [rgb(t.warning), rgb(t.danger)];
    assert.ok(Math.hypot(...a.map((x, i) => x - b[i])) > 70, `${name}: amber and red must look different`);
  }
});
