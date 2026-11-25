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

- **Goals:** savings and investments. A goal has a name, an optional target amount and date, an optional planned amount
  per month, and optional buckets (Savings account, FD, Liquid fund…). Log money added, or withdraw (a negative add).
  Each goal shows saved so far, % of target, what's left, this month against the plan, the monthly amount needed to
  reach the target by its date (only when both are set), and the split by bucket. Goal money is kept apart from
  expenses and never counts toward spending, budgets, month-to-date comparisons or trends. Insights shows one line,
  "Saved this month". Three goals are seeded with ₹0 targets.
- **Bills & renewals:** credit card dues, EMIs, insurance, subscriptions, bills. Each has a recurrence, a next due date
  and a warning window. Overdue (red), due soon (amber) and later are shown on the Bills screen, and Home shows an
  Upcoming card when something is overdue or inside its window. In-app only: there are no push notifications.
  Mark paid moves the date on and offers to log the expense (amount and category prefilled; the toggle defaults
  ON, but OFF for credit card dues so card bills aren't counted twice). Skip this one moves the date with no expense.
  EMIs count instalments down and archive themselves at zero or past their end date, with Undo.

Amounts are stored as whole paise (integers), never as floating-point rupees. They are shown in INR with Indian digit grouping (₹1,25,000).

## Navigation

The tab bar is Home, History, **+**, Goals, Bills. Insights, Plan and Settings are in the menu (☰) at the top right of
every screen, and Home links to Insights and Plan too.

## Data and upgrades

IndexedDB database `crux`, schema version 2: `categories`, `budgets`, `entries`, `goals`, `goalAdds`, `bills`, `meta`.
Upgrading from 1.0.x only adds the three new stores, so existing data is untouched (the browser test builds a real
version-1 database and upgrades it). Backups are schema 2 and carry goals, goal entries and bills; a backup exported
from 1.0.x still imports, and keeps the goals and bills already on the device.

## Run it locally

```bash
npm start            # http://localhost:8080
npm test             # unit tests (money, dates, budgets, goals, bills, backup, release checks), in several time zones
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
