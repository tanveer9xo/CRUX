// Bump APP_VERSION on every release, together with VERSION in sw.js (a test checks they match).
// The service worker's cache is named after it, so a bump makes every installed copy fetch the new files.
export const APP_VERSION = '1.3.1';

// Shape of the stored data and of backup files. Bump only when that shape changes.
export const SCHEMA_VERSION = 3; // 3: income and incomeSources stores (1.2.0). 2: goals, goalAdds, bills (1.1.x). 1: categories, budgets, entries, meta (1.0.x).
