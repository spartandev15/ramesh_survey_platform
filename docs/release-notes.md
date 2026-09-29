# Release notes

Each delivery with its commit, what changed, how it was verified and what is still open. Requirement status is in [traceability.md](traceability.md); open gates and proposals are in [open-items.md](open-items.md).

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
