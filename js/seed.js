// First-run categories, in this order. Every budget starts at ₹0: real budgets are set inside the app and
// stay on the device, so no amounts live in the repo. Emoji and colour are distinct per category.
// Pure data, so tests/seed.test.js can check it without a browser.

// Each category has an icon key (js/icons.js) and a colour from a refined, slightly desaturated palette that works in
// both themes; neighbouring categories get clearly different hues. `emoji` is kept in the data for older versions
// (a downgrade or an old backup still shows something) but is never displayed.
export const SEED_CATEGORIES = [
  { name: 'Rent', icon: 'home', emoji: '🏠', color: '#6B8FD6' },
  { name: 'Bike EMI', icon: 'bike', emoji: '🏍️', color: '#D9875A' },
  { name: 'Buffer/Miscellaneous', icon: 'layers', emoji: '📦', color: '#8E97A6' },
  { name: 'Groceries', icon: 'shopping-basket', emoji: '🛒', color: '#4FAF86' },
  { name: 'CC Payment', icon: 'credit-card', emoji: '💳', color: '#9B87D9' },
  { name: 'Dine In/Out', icon: 'utensils', emoji: '🍽️', color: '#D47A9B' },
  { name: 'Gym', icon: 'dumbbell', emoji: '🏋️', color: '#5DAE5B' },
  { name: 'Petrol', icon: 'fuel', emoji: '⛽', color: '#C9A24B' },
  { name: 'Bhatuk', icon: 'paw-print', emoji: '🎈', color: '#D97F7A' },
  { name: 'Insurance', icon: 'shield-check', emoji: '🛡️', color: '#4FA9C4' },
  { name: 'Subscriptions', icon: 'repeat', emoji: '🔁', color: '#B27CC9' },
  { name: 'Wifi', icon: 'wifi', emoji: '📶', color: '#7484D9' },
  { name: 'Furniture', icon: 'armchair', emoji: '🛋️', color: '#A87C5C' },
  { name: 'Electricity', icon: 'zap', emoji: '⚡', color: '#D9C140' },
  { name: 'Supplements', icon: 'pill', emoji: '💊', color: '#6CC0A0' },
  { name: 'Cosmetics', icon: 'sparkles', emoji: '💄', color: '#E08FB2' },
  { name: 'Bike Maintenance', icon: 'wrench', emoji: '🔧', color: '#94806E' },
  { name: 'Phone Bill', icon: 'smartphone', emoji: '📱', color: '#8FC45A' },
];

export const SEED_BUDGET = 0; // paise

// Swatches offered when adding or editing a category or goal: the refined palette. Chips adjust the icon colour per
// theme for contrast (js/color.js), so stored colours never need changing.
export const COLORS = SEED_CATEGORIES.map((c) => c.color);

// First-run goals. Targets are ₹0 (none set): real targets are entered in the app. "Long-term investments" may stay
// without a target for good.
export const SEED_GOALS = [
  { name: 'Emergency fund', icon: 'shield', emoji: '🛟', color: '#4FA9C4' },
  { name: 'Wedding fund', icon: 'gem', emoji: '💍', color: '#D47A9B' },
  { name: 'Long-term investments', icon: 'trending-up', emoji: '📈', color: '#4FAF86' },
];

// Suggested goals offered by the "New goal" picker. None of these is created by default.
export const GOAL_STARTERS = [
  { name: 'Brother’s education', icon: 'graduation-cap', color: '#7484D9' },
  { name: 'Car', icon: 'car', color: '#D9875A' },
  { name: 'Travel fund', icon: 'plane', color: '#4FA9C4' },
  { name: 'Honeymoon', icon: 'palm-tree', color: '#E08FB2' },
  { name: 'Custom', icon: 'target', color: '#9B87D9', custom: true },
];

// ---- icon migration (1.3.0): records that only had an emoji get an icon key ----
const norm = (n) => String(n ?? '').trim().toLowerCase().replace(/[’']/g, "'");
const BY_NAME = Object.fromEntries([...SEED_CATEGORIES, ...SEED_GOALS, ...GOAL_STARTERS.filter((g) => !g.custom)].map((x) => [norm(x.name), x]));

/** The default icon for a category or goal name; anything unmatched gets the neutral "tag". */
export const defaultIconFor = (name) => BY_NAME[norm(name)]?.icon ?? 'tag';

/**
 * Give a category or goal an icon key (and a goal a colour) if it has none, without touching anything else:
 * the old emoji stays in the record, and existing colours are kept as they are.
 * `valid` says whether an icon key exists. Returns the same object when nothing changes.
 */
export function withIcon(record, { valid, index = 0 } = {}) {
  const needsIcon = !(typeof record.icon === 'string' && valid(record.icon));
  const needsColor = !(typeof record.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(record.color));
  if (!needsIcon && !needsColor) return record;
  return {
    ...record,
    ...(needsIcon ? { icon: defaultIconFor(record.name) } : {}),
    ...(needsColor ? { color: BY_NAME[norm(record.name)]?.color ?? COLORS[index % COLORS.length] } : {}),
  };
}
