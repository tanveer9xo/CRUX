import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ICON_KEYS, PICKER_ICONS, hasIcon, resolveIcon, iconShapes } from '../js/icons.js';
import { SEED_CATEGORIES, SEED_GOALS, GOAL_STARTERS, defaultIconFor, withIcon } from '../js/seed.js';
import { BILL_TYPES } from '../js/bills.js';

const SHAPES = { path: ['d'], circle: ['cx', 'cy', 'r'], rect: ['width', 'height'], line: ['x1', 'x2', 'y1', 'y2'], polyline: ['points'], polygon: ['points'] };

test('every icon in the registry parses into plain shapes with the attributes they need', () => {
  assert.ok(ICON_KEYS.length >= 70);
  for (const key of ICON_KEYS) {
    const shapes = iconShapes(key);
    assert.ok(shapes.length > 0, `${key} has no shapes`);
    for (const [tag, attrs] of shapes) {
      assert.ok(tag in SHAPES, `${key}: unexpected <${tag}>`);
      for (const a of SHAPES[tag]) assert.ok(a in attrs, `${key}: <${tag}> is missing ${a}`);
      for (const [k, v] of Object.entries(attrs)) {
        assert.ok(['d', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'ry', 'width', 'height', 'x1', 'x2', 'y1', 'y2', 'points'].includes(k), `${key}: attribute ${k} not allowed`);
        assert.doesNotMatch(v, /[<>"]|url\(|javascript/i, `${key}: unsafe value`);
      }
      if (tag === 'path') assert.match(attrs.d, /^[Mm][\d\s.,\-MmLlHhVvCcSsQqTtAaZz]+$/, `${key}: path data`);
    }
  }
});

test('every icon key the app refers to resolves', () => {
  const used = new Set([
    ...SEED_CATEGORIES.map((c) => c.icon), ...SEED_GOALS.map((g) => g.icon), ...GOAL_STARTERS.map((g) => g.icon),
    ...BILL_TYPES.map((t) => t.icon), ...PICKER_ICONS.map(([k]) => k), 'tag',
  ]);
  // …and every icon('name') call in the code.
  const dirs = ['js', 'js/views'];
  for (const d of dirs) for (const f of readdirSync(new URL(`../${d}/`, import.meta.url)).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(new URL(`../${d}/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bicon\('([\w-]+)'/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(hasIcon(k), `icon “${k}” is not in the registry`);
  assert.equal(resolveIcon('no-such-icon'), 'tag');
});

test('the picker offers about 40 distinct icons, each with words to search by', () => {
  assert.ok(PICKER_ICONS.length >= 40);
  assert.equal(new Set(PICKER_ICONS.map(([k]) => k)).size, PICKER_ICONS.length);
  for (const [, words] of PICKER_ICONS) assert.ok(words.length > 2);
});

test('the 18 categories, the goals, the suggestions and the bill types have the requested defaults', () => {
  const cat = Object.fromEntries(SEED_CATEGORIES.map((c) => [c.name, c.icon]));
  assert.deepEqual(cat, {
    Rent: 'home', 'Bike EMI': 'bike', 'Buffer/Miscellaneous': 'layers', Groceries: 'shopping-basket', 'CC Payment': 'credit-card', 'Dine In/Out': 'utensils',
    Gym: 'dumbbell', Petrol: 'fuel', Bhatuk: 'paw-print', Insurance: 'shield-check', Subscriptions: 'repeat', Wifi: 'wifi', Furniture: 'armchair',
    Electricity: 'zap', Supplements: 'pill', Cosmetics: 'sparkles', 'Bike Maintenance': 'wrench', 'Phone Bill': 'smartphone',
  });
  assert.deepEqual(SEED_GOALS.map((g) => g.icon), ['shield', 'gem', 'trending-up']);
  assert.deepEqual(GOAL_STARTERS.filter((g) => !g.custom).map((g) => [g.name, g.icon]), [['Brother’s education', 'graduation-cap'], ['Car', 'car'], ['Travel fund', 'plane'], ['Honeymoon', 'palm-tree']]);
  assert.deepEqual(Object.fromEntries(BILL_TYPES.map((t) => [t.label, t.icon])), {
    'Credit card due': 'credit-card', EMI: 'calendar-clock', Insurance: 'shield-check', Subscription: 'repeat', Bill: 'receipt', Other: 'circle-dollar-sign',
  });
});

test('migration: icons by exact name, “tag” for anything unmatched, emoji and colour kept', () => {
  const valid = hasIcon;
  assert.equal(defaultIconFor('Bhatuk'), 'paw-print');
  assert.equal(defaultIconFor('  rent '), 'home'); // trimmed, any case
  assert.equal(defaultIconFor('Brother\'s education'), 'graduation-cap'); // straight or curly apostrophe
  assert.equal(defaultIconFor('Old category'), 'tag');
  assert.equal(defaultIconFor(''), 'tag');
  const old = { id: 'c1', name: 'Groceries', emoji: '🛒', color: '#199E70', order: 3 };
  const m = withIcon(old, { valid });
  assert.deepEqual(m, { ...old, icon: 'shopping-basket' }); // colour untouched, emoji kept
  assert.equal(withIcon({ ...old, name: 'Takeaways' }, { valid }).icon, 'tag');
  assert.equal(withIcon(m, { valid }), m); // already migrated: the very same object, nothing to write
  assert.equal(withIcon({ ...old, icon: 'nonsense' }, { valid }).icon, 'shopping-basket'); // an unknown key is repaired
  // Goals had no colour: they get the default for their name, or a palette colour.
  const g = withIcon({ id: 'g', name: 'Emergency fund', emoji: '🛟' }, { valid });
  assert.deepEqual([g.icon, g.color, g.emoji], ['shield', '#4FA9C4', '🛟']);
  assert.match(withIcon({ id: 'g2', name: 'Boat', emoji: '⛵' }, { valid, index: 2 }).color, /^#[0-9A-F]{6}$/i);
});

test('no emoji is displayed by the code: views and UI modules contain no emoji characters', () => {
  const EMOJI = /\p{Extended_Pictographic}/u;
  for (const d of ['js', 'js/views']) for (const f of readdirSync(new URL(`../${d}/`, import.meta.url)).filter((x) => x.endsWith('.js') && x !== 'seed.js')) {
    const src = readFileSync(new URL(`../${d}/${f}`, import.meta.url), 'utf8');
    const m = src.match(EMOJI);
    assert.ok(!m, `${d}/${f} contains ${m?.[0]} near “${m ? src.slice(Math.max(0, m.index - 40), m.index + 5) : ''}”`);
  }
  for (const f of ['index.html', 'css/app.css']) assert.ok(!readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').match(EMOJI), f);
});
