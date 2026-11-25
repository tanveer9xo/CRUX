// Bump APP_VERSION on every release, together with VERSION in sw.js (a test checks they match).
// The service worker's cache is named after it, so a bump makes every installed copy fetch the new files.
export const APP_VERSION = '1.1.1';

// Shape of the stored data and of backup files. Bump only when that shape changes.
export const SCHEMA_VERSION = 2; // 2: goals, goalAdds and bills stores (1.1.0). 1: categories, budgets, entries, meta (1.0.x).
