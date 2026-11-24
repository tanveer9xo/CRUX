# CRUX

A personal expense tracker that runs offline and installs to your phone's home screen.
It's plain HTML, CSS and JavaScript, with no build step, no backend, no accounts and no analytics.
Your data stays in this browser's IndexedDB on your device.

## What it does

- **Plan:** set up categories with an emoji, a colour and a monthly budget. You can add, rename, reorder and archive them.
  A budget change applies from the month you're viewing onward. Earlier months keep their budgets: they are
  stored per month and copied forward when a new month starts.
- **Quick add:** tap **+**, type the amount, tap a category, then tap Save. The date defaults to today, and you can add an optional note.
  You can edit or delete any entry, and Undo is offered after a delete.
- **Home:** this month's spending against the total budget, with a progress bar per category (amber at 80 %, red when over)
  and the latest entries.
- **History:** pick a month, filter by category, and search notes in one month or all months. Entries are listed by day.
- **Insights:**
  - Month to date against the same days last month, per category and in total.
  - Each completed month against the one before it, with a 6-month trend.
  - Budget used and remaining, per category and in total, with a per-day allowance.
- **Backup:** export a JSON file, or import one (CRUX shows what's in it and asks before replacing anything).
  A banner reminds you when your last export is more than 14 days old.

Amounts are stored as whole paise (integers), never as floating-point rupees. They are shown in INR with Indian digit grouping (₹1,25,000).

## Run it locally

```bash
npm start            # http://localhost:8080
npm test             # unit tests (maths, dates, budgets, backup, release checks), in several time zones
npm run test:browser # headless Chrome: the built site served under /CRUX/, end to end
npm run icons        # re-render icons from js/brand.js
```

## Releasing

1. Bump the version in three places: `APP_VERSION` in `js/version.js`, `VERSION` in `sw.js`, and `version` in `package.json`.
   A test fails if they don't match. The service worker's cache is named after this version, so installed copies
   download the new files and show an "Update ready" banner.
2. If you add a file, add it to `ASSETS` in `sw.js`. A test fails if an app file isn't precached.
3. Push to `main`. GitHub Actions runs the tests, then deploys to Pages.

## Sharing the github.io origin with VANE

CRUX and VANE are both served from `https://<user>.github.io/`, so they share storage. Every name CRUX uses
starts with `crux`: the `crux` IndexedDB database, any localStorage keys, and the `crux-<version>` caches.
The service worker only handles requests under `/CRUX/` and only deletes its own caches. Tests check all of this.
