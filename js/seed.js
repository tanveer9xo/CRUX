// First-run categories, in this order. Every budget starts at ₹0: real budgets are set inside the app and
// stay on the device, so no amounts live in the repo. Emoji and colour are distinct per category.
// Pure data, so tests/seed.test.js can check it without a browser.

export const SEED_CATEGORIES = [
  { name: 'Rent', emoji: '🏠', color: '#3987E5' },
  { name: 'Bike EMI', emoji: '🏍️', color: '#D95926' },
  { name: 'Buffer/Miscellaneous', emoji: '📦', color: '#7C8796' },
  { name: 'Groceries', emoji: '🛒', color: '#199E70' },
  { name: 'CC Payment', emoji: '💳', color: '#9085E9' },
  { name: 'Dine In/Out', emoji: '🍽️', color: '#D55181' },
  { name: 'Gym', emoji: '🏋️', color: '#0CA30C' },
  { name: 'Petrol', emoji: '⛽', color: '#C98500' },
  { name: 'Bhatuk', emoji: '🎈', color: '#E66767' },
  { name: 'Insurance', emoji: '🛡️', color: '#4FB6D9' },
  { name: 'Subscriptions', emoji: '🔁', color: '#B06BD8' },
  { name: 'Wifi', emoji: '📶', color: '#5C6FE0' },
  { name: 'Furniture', emoji: '🛋️', color: '#A47C48' },
  { name: 'Electricity', emoji: '⚡', color: '#D8C23A' },
  { name: 'Supplements', emoji: '💊', color: '#6BD39B' },
  { name: 'Cosmetics', emoji: '💄', color: '#F08FB6' },
  { name: 'Bike Maintenance', emoji: '🔧', color: '#8E6C5A' },
  { name: 'Phone Bill', emoji: '📱', color: '#A0B94A' },
];

export const SEED_BUDGET = 0; // paise

// Swatches offered when adding or editing a category: the seed colours (the first eight are the validated
// dark-mode categorical steps; the rest extend them). Status colours (amber, red) stay out of the UI's own use.
export const COLORS = SEED_CATEGORIES.map((c) => c.color);

// First-run goals. Targets are ₹0 (none set): real targets are entered in the app. "Long-term investments" may stay
// without a target for good.
export const SEED_GOALS = [
  { name: 'Emergency fund', emoji: '🛟' },
  { name: 'Wedding fund', emoji: '💍' },
  { name: 'Long-term investments', emoji: '📈' },
];

// Suggested goals offered by the "New goal" picker. None of these is created by default.
export const GOAL_STARTERS = [
  { name: 'Brother’s education', emoji: '🎓' },
  { name: 'Car', emoji: '🚗' },
  { name: 'Travel fund', emoji: '✈️' },
  { name: 'Honeymoon', emoji: '🌴' },
  { name: 'Custom', emoji: '🎯', custom: true },
];
