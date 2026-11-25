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
  EMIs count instalments down (paying counts one down whether or not it logs an expense; Skip doesn't) and archive
  themselves at zero or past their end date, with Undo. A bill that is past its end date but still overdue stays, since
  it is still owed. "Last day of the month" makes a bill's due day follow month length (28/29/30/31); switching it off
  keeps the date and turns it into a fixed due day.

- **Income:** log what comes in (Salary, Bonus, Other…) by month. A recurring income such as a salary has an expected
  amount and day (with the same month-end rules as bills, including "last day of the month"); Home shows it as
  "Income expected" and one tap on Received logs it, with Undo. Income is its own list: never an expense or a goal add,
  and never part of spending totals, budget bars or spending comparisons.
- **Month plan:** income expected (and received so far) − category budgets − planned goal contributions = unassigned,
  amber when over-planned. Leftover so far = income received − expenses − goal adds this month. **Allocate leftover**
  prefills each goal's remaining monthly plan in priority order (the order on the Goals screen; reorder with the
  arrows) and blocks allocating more than the leftover. It records goal entries in CRUX only; no real money moves.
  A compact version sits on Home.
- **Goal starters:** New goal offers Brother's education, Car, Travel fund, Honeymoon or Custom (none created by default).
- **Insights → Savings:** savings rate (goal adds ÷ income received; "—" when there's no income) for this month so far
  against the same days last month, and a 6-month income / spent / saved chart and table.

Amounts are stored as whole paise (integers), never as floating-point rupees. They are shown in INR with Indian digit grouping (₹1,25,000).

## Look and feel

- **Design system:** every colour, size, radius, shadow and duration comes from CSS tokens at the top of
  `css/app.css`. Dark is the default; Settings → Appearance offers Light and System. A test reads the tokens and checks
  WCAG AA contrast for text and the amber/red/green states in both themes.
- **Icons:** one monoline SVG set (`js/icons.js`, paths from Lucide under the ISC licence: see `NOTICE`). Categories,
  goals and bill types show their icon in a rounded chip tinted with their colour; the icon colour is adjusted per theme
  only as far as contrast needs, and stored colours never change. No emoji is displayed anywhere (a test scans every
  rendered screen). Category and goal editors have an icon picker with search and colour swatches.
- **Upgrading to 1.3.0:** categories and goals gain an icon key, by exact name (anything unmatched gets "tag"); the old
  emoji stays in the data, so older versions and backups still work.

## Navigation

The tab bar is Home, History, **+**, Goals, Bills. Month plan, Income, Insights, Plan and Settings are in the menu (☰)
at the top right of every screen; Home links to the month plan, Insights and Plan too.

## Data and upgrades

IndexedDB database `crux`, schema version 3: `categories`, `budgets`, `entries`, `goals`, `goalAdds`, `bills`,
`income`, `incomeSources`, `meta`. Upgrades only add stores, so existing data is untouched (the browser test builds
real version-1 and version-2 databases and upgrades them). Backups are schema 3. A backup from 1.0.x or 1.1.x still
imports and keeps whatever it doesn't carry (goals and bills, income) exactly as it is on the device.

## Run it locally

```bash
npm start            # http://localhost:8080
npm test             # unit tests (money, dates, budgets, goals, bills, backup, release checks), in several time zones
npm run test:browser # headless Chrome: the built site served under /CRUX/, end to end
npm run test:screens # every screen at 360/390/430 px in dark and light: overflow, 44px targets, no emoji (SHOTS=dir saves PNGs)
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
