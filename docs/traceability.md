# Requirement traceability

Every requirement in the *PSG Survey Development Requirements Package* (SR-01 to SR-48), where it stands, and the automated tests that prove its acceptance check (AT-xx). Generated from `requirements.csv` and the AT tags in the test files.

Test files: `src/**/*.test.ts` (unit), `src/**/*.db.test.ts` (database, run with `npm test`), `e2e/*.spec.ts` (browser, run with `npm run test:e2e` against a production build). The exact commit, run date and results of each delivery are recorded in [release-notes.md](release-notes.md).

| Req. | Release | Title | Status | Acceptance tests |
| --- | --- | --- | --- | --- |
| SR-01 | R1 | Reuse Hub access | Built and tested, including write attempts on another shop. Runs as its own application with its own sign-in, not inside an existing Hub: a change to confirm (open-items §3). | AT-01: `e2e/accessibility-security.spec.ts`<br>`src/modules/cases/shop-isolation.db.test.ts`<br>`e2e/dashboard.spec.ts`<br>`src/modules/access/capabilities.test.ts`<br>`src/modules/responses/staff-store.db.test.ts` |
| SR-02 | R1 | Shop branding | Built and tested. | AT-02: `e2e/accessibility-security.spec.ts` |
| SR-03 | R1 | Mode controls | Built and tested. | AT-03: `e2e/import-flow.spec.ts`<br>`src/modules/email-ledger/email-ledger.test.ts`<br>`src/modules/email-ledger/store.db.test.ts`<br>`src/modules/imports/imports.test.ts`<br>`src/modules/imports/store.db.test.ts`<br>`src/modules/responses/store.db.test.ts`<br>`src/modules/shops/settings-policy.test.ts`<br>`src/modules/shops/settings-store.db.test.ts` |
| SR-04 | R1 | Activation and waiting queue | Built and tested. | AT-04: `src/modules/imports/imports.test.ts`<br>`src/modules/imports/store.db.test.ts`<br>`src/modules/shops/settings-store.db.test.ts` |
| SR-05 | R1 | Delivery cutoff | Built and tested. | AT-05: `src/modules/imports/imports.test.ts`<br>`src/modules/imports/store.db.test.ts`<br>`src/modules/shops/settings-policy.test.ts`<br>`src/modules/shops/settings-store.db.test.ts` |
| SR-06 | R1 | Document-triggered import | Built and tested. | AT-06: `e2e/import-flow.spec.ts`<br>`src/modules/imports/imports.test.ts`<br>`src/modules/imports/store.db.test.ts` |
| SR-07 | R1 | Visit deduplication | Built and tested. Rows with an unclear visit identity go to the operator queue with an owner. | AT-07: `src/modules/imports/imports.test.ts`<br>`src/modules/imports/store.db.test.ts`<br>`src/modules/operations/store.db.test.ts` |
| SR-08 | R1 | Legacy exclusion | Built and tested. | AT-08: `src/modules/imports/imports.test.ts`<br>`src/modules/imports/store.db.test.ts` |
| SR-09 | R1 | Missing email | Built and tested. | AT-09: `e2e/import-flow.spec.ts`<br>`src/modules/imports/imports.test.ts`<br>`src/modules/imports/store.db.test.ts` |
| SR-10 | R1 | Missing delivery date | Built and tested. | AT-10: `e2e/import-flow.spec.ts`<br>`src/modules/imports/imports.test.ts`<br>`src/modules/imports/store.db.test.ts` |
| SR-11 | R1 | Explicit sending after correction | Built and tested. | AT-11: `src/modules/imports/store.db.test.ts` |
| SR-12 | R1 | Personalized access | Built and tested. | AT-12: `e2e/respondent.spec.ts`<br>`src/lib/qr.test.ts`<br>`src/modules/responses/store.db.test.ts` |
| SR-13 | R1 | Public shop access | Built and tested. | AT-13: `e2e/paper-matching.spec.ts`<br>`src/modules/responses/staff-store.db.test.ts` |
| SR-14 | R1 | Current PSG instrument | Engine, versioning and golden-fixture tests built. The real PSG questions, scoring and alert rules are not entered: they wait for PSG (G-01). Only TEST content exists. | AT-14: `e2e/shop-settings.spec.ts`<br>`e2e/survey-flow.spec.ts`<br>`src/modules/instruments/store.db.test.ts`<br>`src/modules/shops/settings-policy.test.ts`<br>`src/modules/shops/settings-store.db.test.ts` |
| SR-15 | R1 | Versioned publication | Built and tested. | AT-15: `e2e/survey-flow.spec.ts`<br>`src/modules/instruments/store.db.test.ts`<br>`src/modules/shops/settings-store.db.test.ts` |
| SR-16 | R1 | Autosave and resume | Built and tested. | AT-16: `e2e/respondent.spec.ts`<br>`src/modules/responses/store.db.test.ts` |
| SR-17 | R1 | Submit once and lock | Built and tested. | AT-17: `e2e/respondent.spec.ts`<br>`src/modules/responses/store.db.test.ts` |
| SR-18 | R1 | Paper entry | Built and tested. | AT-18: `e2e/paper-matching.spec.ts`<br>`src/modules/instruments/evaluate.test.ts`<br>`src/modules/responses/staff-store.db.test.ts` |
| SR-19 | R1 | Duplicate submissions | Built and tested. | AT-19: `e2e/paper-matching.spec.ts`<br>`src/modules/responses/staff-store.db.test.ts` |
| SR-20 | R1 | Audited corrections | Built and tested. | AT-20: `e2e/paper-matching.spec.ts`<br>`src/modules/cases/store.db.test.ts`<br>`src/modules/dashboard/store.db.test.ts`<br>`src/modules/responses/staff-store.db.test.ts` |
| SR-21 | R1 | Link expiry | Built and tested. | AT-21: `src/modules/responses/store.db.test.ts` |
| SR-22 | R1 | Expired-link renewal | Built and tested. | AT-22: `e2e/email-flow.spec.ts`<br>`src/modules/email-ledger/store.db.test.ts` |
| SR-23 | R1 | Email invitation ledger | Built and tested. | AT-23: `e2e/email-flow.spec.ts`<br>`src/app/api/survey-mail/events/route.db.test.ts`<br>`src/modules/email-ledger/store.db.test.ts` |
| SR-24 | R1 | One reminder total | Built and tested. A paper or public response matched to the visit stops its invitation, reminder and renewal, like a link answer; the visit moves to Excluded ("Survey already answered") and gets no printable link. | AT-24: `src/modules/email-ledger/email-ledger.test.ts`<br>`src/modules/email-ledger/store.db.test.ts` |
| SR-25 | R1 | Shop-only opt-out | Built and tested. | AT-25: `e2e/email-flow.spec.ts`<br>`src/modules/email-ledger/email-ledger.test.ts`<br>`src/modules/email-ledger/store.db.test.ts` |
| SR-26 | R1 | Paused operation | Built and tested. | AT-26: `src/modules/email-ledger/email-ledger.test.ts`<br>`src/modules/email-ledger/store.db.test.ts`<br>`src/modules/shops/settings-policy.test.ts` |
| SR-27 | R1 | Immediate results | Built and tested. | AT-27: `e2e/dashboard.spec.ts`<br>`src/modules/dashboard/store.db.test.ts` |
| SR-28 | R1 | Known-shop unmatched results | Built and tested. | AT-28: `e2e/dashboard.spec.ts`<br>`e2e/paper-matching.spec.ts`<br>`src/modules/dashboard/cohort.test.ts`<br>`src/modules/dashboard/store.db.test.ts`<br>`src/modules/responses/staff-store.db.test.ts` |
| SR-29 | R1 | Shop suggestions | Confirm-shop screen, evidence display and PSG-only visibility built and tested. Nothing creates unknown-shop records or suggestions yet: they arrive with the history load, whose source fields decide the evidence (G-03). | AT-29: `src/modules/responses/staff-store.db.test.ts` |
| SR-30 | R1 | Historical reporting | Read-only historical storage and display on its own scales built and tested (filled by demo data only). The loader for the live Supabase history is not built: it needs the source and mappings (G-03). | AT-30: `src/modules/dashboard/store.db.test.ts` |
| SR-31 | R1 | Dashboard and exports | Built and tested. | AT-31: `e2e/dashboard.spec.ts`<br>`src/modules/dashboard/cohort.test.ts`<br>`src/modules/dashboard/store.db.test.ts` |
| SR-32 | R1 | PSG-first negative alerts | Built and tested. | AT-32: `e2e/alerts.spec.ts`<br>`src/modules/cases/store.db.test.ts` |
| SR-33 | R1 | Approve and send alerts | Built and tested. | AT-33: `e2e/alerts.spec.ts`<br>`src/modules/cases/store.db.test.ts` |
| SR-34 | R1 | Follow-up and resolution | Built and tested. | AT-34: `e2e/alerts.spec.ts`<br>`src/modules/cases/store.db.test.ts` |
| SR-35 | R1 | Hub ownership and outage tolerance | Built and tested. | AT-35: `e2e/paper-matching.spec.ts`<br>`src/modules/filemaker-independence.test.ts` |
| SR-36 | R1 | Interim suppression queue | Built and tested. | AT-36: `e2e/alerts.spec.ts`<br>`src/modules/cases/store.db.test.ts` |
| SR-37 | R1 | All-shop readiness | Built and tested. The first switch to Live needs every check; existing opt-out lists import; the manifest exports as CSV. | AT-37: `e2e/readiness.spec.ts`<br>`src/modules/readiness/store.db.test.ts` |
| SR-38 | R1 | Operational accountability | Built and tested. | AT-38: `e2e/operations.spec.ts`<br>`src/modules/operations/store.db.test.ts`<br>`src/app/psg/responses/export/route.db.test.ts` |
| SR-39 | R1 | Usability and accessibility | Built and tested: keyboard-only journey and an automated WCAG 2.1 AA scan of the main pages. | AT-39: `e2e/accessibility-security.spec.ts`<br>`e2e/accessibility-scan.spec.ts` |
| SR-40 | R1 | Data protection | Security controls built and tested (tenant checks, signed webhooks, no-store pages, token redaction, formula-safe export, rate limits). The retention policy waits for PSG (G-07). | AT-40: `e2e/accessibility-security.spec.ts`<br>`e2e/dashboard.spec.ts`<br>`src/app/api/survey-mail/events/route.db.test.ts`<br>`src/lib/csv.test.ts`<br>`src/app/psg/responses/export/route.db.test.ts` |
| SR-41 | R2 | Temporary FileMaker bridge | Outbox, idempotent writes, read-back confirmation and conflict quarantine built and tested against an in-memory FileMaker. Writes stay off until the FileMaker field map and access exist (G-09). | AT-41: `src/modules/bridge/bridge.db.test.ts` |
| SR-42 | R2 | Legacy alert exclusion | Source marker and the 'legacy alerts skip Hub records' check built. The FileMaker-script side is verified by the FileMaker owner (G-09). | AT-42: `src/modules/bridge/bridge.db.test.ts` |
| SR-43 | R2 | Reconciliation and conflict handling | Replay, retry, outage recovery and lag display built and tested with the in-memory FileMaker. Live verification waits for G-09. | AT-43: `src/modules/bridge/bridge.db.test.ts` |
| SR-44 | R2 | Form builder | Built and tested. | AT-44: `e2e/survey-flow.spec.ts`<br>`src/modules/shops/settings-store.db.test.ts` |
| SR-45 | R2 | Shop additions | Built and tested. | AT-45: `e2e/shop-additions.spec.ts`<br>`src/modules/instruments/additions.db.test.ts` |
| SR-46 | R2 | Historical unresolved cases | Built and tested. | AT-46: `e2e/legacy-cases.spec.ts`<br>`src/modules/legacy-cases/store.db.test.ts` |
| SR-47 | R2 | Bridge retirement | Dependency inventory, blockers and signed retirement built and tested. Retirement itself happens only when the real dependencies are dealt with. | AT-47: `src/modules/bridge/retirement.db.test.ts` |
| SR-48 | R2 | Scale and recovery | npm run load-test met every target on this PC (save p95 381 ms, submit p95 419 ms, dashboard p95 1.45 s, 100 emails in 106 s, nothing lost or duplicated). npm run restore-drill is ready and waits for an empty drill database. | AT-48: `scripts/load-test.ts`, `scripts/restore-drill.ts` |

Gates that are still open are listed in [open-items.md](open-items.md).
