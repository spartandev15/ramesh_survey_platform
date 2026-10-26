# Release notes

Each delivery with its commit, what changed, how it was verified and what is still open. Requirement status is in [traceability.md](traceability.md); open gates and proposals are in [open-items.md](open-items.md).

## 2026-10-26: test deployment on shared hosting, fixes from testing it live

**Where:** `https://survey.spartanbots.xyz` (Namecheap shared cPanel hosting, database on Supabase). Setup is in the runbook, section 1a.

**Fixed**

- A survey page no longer waits forever when the reply to a save or a submit never arrives: after 20 seconds it reloads its state from the server (the thank-you page, if the submit arrived), keeps the answers on screen and asks the customer to try again. Trying again never submits twice.
- Forms that redirect after saving reached the wrong address on this host (the app is handed a socket, not a port).
- The worker's job queue could use up the database's 15-client limit; app and queue connections are now set separately (`DATABASE_POOL_MAX`, `QUEUE_POOL_MAX`).
- Long tables can be scrolled with the keyboard (axe `scrollable-region-focusable`).
- The web app's log is kept on this host (`stderr.log`) and kept under 10 MB.

**Verified on the live site:** all 18 browser test files (25 tests) pass against `survey.spartanbots.xyz`, including a new test for the lost-reply recovery; 345 unit and database tests pass locally; no email left the server during testing (`EMAIL_PROVIDER=log`).

**Open:** the cron line for the worker, deleting `admin-password.txt` after reading it, a captcha on public pages (deferred), and test data on the live database to clear before real use.

## 2026-10-26: full audit fixes, dashboard question results, Copy a survey

**Branch:** `main` · **Previous delivery:** `7848df4` (2026-09-29). In between: `5d9ce14` (09-30, migrations 0030 and 0031), the 10-23 deliveries (page tours, working top-bar search and notification bell, bundled worker and scripts, backup and reverse-proxy files, Next.js 16.4.2 for security advisories) and the 10-26 deliveries below.

A second line-by-line audit of the package (SR-01 to SR-48, 04, 07, 09) and a separate security review were run against the code. Nothing release-blocking was found in the code; the fixes below close what was found on our side.

**Added**

- Dashboard **Question results**: how customers answered each question of the version the scores show. Clicking an answer, or the new *Answer* filter, narrows the whole page, the list and the CSV export (`report_answer` column), so the export still matches the screen (AT-31).
- **Copy a survey** in the *Create new survey* box: a draft copy of any version of any survey.

**Fixed**

- Correcting one visit's email no longer changes the email on the same customer's other visits (their reminders kept going to the old address's replacement).
- A survey save whose reply was lost (a dropped phone connection) no longer forces the customer to reload and lose newer answers (SR-16).
- Users of a deleted (archived) shop can no longer open its dashboard, follow-up cases or notifications.
- Text on a shop's brand colour (survey header and emails) now always meets WCAG AA contrast (SR-02, SR-39).
- The PSG dashboard shop picker showed no name when the address had no shop in it.
- Negative numbers in CSV exports stay numbers (they were written as text).
- The dashboard says so when a range has more than 20,000 responses instead of silently counting the newest 20,000.
- The first switch to Live locks the shop's settings before checking the launch checklist, and the gate now has a test.
- Security: production logs no longer contain password-reset links or recipient addresses; backups are readable only by their owner and the database address stays off the command line; the nginx access log leaves out survey and reset tokens; `docker-compose.yml` restarts the database, web app and worker by themselves and has no default database password; the public form checks its input before using it in a rate-limit key.
- zod 4.6.7 (high-severity advisory); one redundant database index removed.

**Migrations:** `0032_drop_redundant_legacy_case_index` (drops `legacy_case_shop_idx`; the unique identity index already starts with `shop_id`). No data changes.

**Verification (2026-10-26, Windows PC, PostgreSQL 17, production build):** lint and typecheck clean; 345 of 345 unit and database tests; `next build` and `npm run build:server`; browser suite 24 of 24 (22 in the full run; the other 2 crashed the browser on this 8 GB PC and passed when rerun on their own); security headers and unauthenticated access checked on the running build.

**Not verified here:** the nginx configuration (no nginx on the development PC: run `nginx -t` on the server), the restore drill, a load test on the production host, and anything behind the open gates in open-items.md.

## 2026-09-29: package cross-check fixes

**Branch:** `main` · **Previous delivery:** `7848df4`

A line-by-line check of the requirements package (documents 01 to 09 and the CSVs) against the code found gaps on our side. This delivery closes them.

**Fixed**

- A double-clicked public or paper submission could save twice and open two alert cases. Submit keys are now unique per source and serialized, and a paper retry with different answers is refused.
- The summary before a shop's first switch to Live now shows real waiting, held and excluded invitation counts and the number of people they reach. Before, it always said "None yet".
- A correction after an alert was approved no longer hides the case, its notes and closure request from the shop (SR-34).
- Import rows that never became a visit (unclear visit identity, failed rows) now reach the operator queue with an owner and a "mark reviewed" note (SR-38, AT-07).
- An older browser tab can no longer submit answers over a newer autosave.
- The results export uses the shop's own calendar for its default dates, names the date basis and filters in every row, and is audited (SR-31).
- A file that fails as a whole keeps its name, size, SHA-256 and error on record (PDF 03 §2).
- The first switch to Live needs the whole launch checklist, and existing opt-out lists can be imported (SR-37).
- Security: rate limits trust only the address our proxy appended; Content-Security-Policy and HSTS in production; opt-out links can have their own key; an archived shop sends nothing more.

**Added**

- Survey: every page is reviewed before submitting, and the browser's Back and Forward move between survey pages.
- Neutral help path on the expired-link page (`SURVEY_HELP_EMAIL`).
- Shops see how to ask PSG for a change.
- Duplicate review shows both answer sets side by side.
- Launch manifest export (CSV).
- Tests: cross-shop write attempts (AT-01), an old link keeps its pinned version (AT-15), a failed save retries (AT-16), a suggested shop sees nothing before confirmation (AT-29), both builder preview branches (AT-44), keep-original duplicates, still-unmatched records, the bridge read-back mismatch, and an automated WCAG 2.1 AA scan.
- The CI workflow runs the database tests after migrating and runs the full browser suite against a production build.
- Docs: decision register (D-01 to D-12, P-01 to P-07), G-06, changes to confirm, known limits, production readiness checklist and smoke test, owner roster template, and the legacy case handoff procedure.

**Migrations:** `0027_submit_key_unique` (unique index), `0028_operator_item_import_row` (check constraint), `0029_import_kind_opt_outs` (enum value). All are additive.

**Verification (2026-09-29, Windows PC, PostgreSQL 17, production build):**

1. `npm run lint`: clean.
2. `npm run typecheck`: clean.
3. `npx vitest run`: 307 of 307 unit and database tests passed (38 files).
4. `npm run build`: succeeded.
5. `npx playwright test` against `next start` with the worker running: 22 of 22 browser tests passed in 12.1 minutes, including the new WCAG 2.1 AA scan (no serious or critical findings).

**Not verified here:** the CI workflow on GitHub (first push), the restore drill (needs a drill database), and anything behind the open gates in open-items.md.

**Risk:** the three migrations only add an index, a check value and an enum value; there are no data changes. The unique submit-key index would fail to build if duplicate keys already existed. None existed in the development database (checked before migrating).
