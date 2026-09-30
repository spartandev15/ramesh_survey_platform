# Open items and proposals

What is still open against the package, what PSG needs to decide or supply, and the working assumptions made so development could continue. Nothing here is hidden in the code: every proposal is a named constant or a documented rule that can change without rework.

## 0. Package decisions (PDF 08) and where they stand

| Id | Decision | In the app |
| --- | --- | --- |
| D-01 | Hub owns new responses, corrections and follow-up; bridge follows R1 | Built; bridge writes off until G-09 |
| D-02 | Hub alone sends new-system alerts | Built; legacy alerts skip Hub records via the source marker (SR-42) |
| D-03 | PSG instrument first, shared core, immutable versions | Built; real content waits for G-01 |
| D-04 | Document import creates customers, visits and unique links; one visit, one invitation | Built |
| D-05 | Post-activation import plus inclusive per-shop cutoff; no automatic backlog | Built |
| D-06 | Legacy invited or completed visits excluded, no override | Built |
| D-07 | One reminder, default 7 days; shop-only opt-out; pause stops outreach only | Built |
| D-08 | Autosave, locked submission, audited corrections, paper entry, first submission counts | Built |
| D-09 | 90-day expiry; renewal to the stored address, same survey | Built |
| D-10 | Results visible at once; PSG reviews alerts first; only PSG resolves | Built |
| D-11 | Known-shop unmatched visible but unscored; unknown shop PSG-only with suggestions | Built except the suggestion source (G-03) |
| D-12 | All shops in R1 after internal testing; manual suppression until the bridge | Built; launch checklist gates the first Live |
| P-01 | One application and database with a transactional outbox | Built, as its own application (section 3) |
| P-02 | Native controls, no vendor purchase | Built (G-10 approval open) |
| P-03 | Rotate tokens on renewal; generic replies; QR lifetime from issue | Built (G-06 sign-off open) |
| P-04 | Reconcile unknown acceptance before retry; reminder from accepted send; overdue reminders after a pause reviewed | Built (G-06 sign-off open) |
| P-05 | Shop questions never change shared scores | Built |
| P-06 | End-to-end seam plus database concurrency tests; measured baselines | Built; baselines measured on a PC, to repeat on the real host (G-07) |
| P-07 | Decide note visibility and retention before shops see notes | Visibility built as proposed (section 2); retention waits for G-07 |

## 1. Waiting on PSG data or access

| Gate | Needed from PSG | What is ready |
| --- | --- | --- |
| G-01 | The exact current survey: wording, option values, branching, required questions, scoring formulas, alert rules and precedence, plus signed golden examples | Survey builder, versioning, server-side scoring and alerts, and a golden-fixture test harness. Only placeholder TEST content and TEST fixtures exist; no fixture is signed off yet (SR-14). |
| G-02 | A sample of the real import file and confirmation of the visit key and repair-order reuse; the legacy sent-invitation ledger | Import with column mapping, dry-run preview, held reasons, legacy exclusion |
| G-03 | Access to the live Supabase history, shop mappings, counts and score scales | Read-only history storage and display on its own scales (SR-30), and the PSG confirm-shop screen (SR-29). Still to build once the source is known: the history loader and the shop suggestions it feeds |
| G-04 | The active routine-mail suppression rules, affected records, timing and the named operator | Suppression queue with acknowledgment evidence (SR-36) |
| G-05 | Named owners and backups for product acceptance, imports, alert review, suppression, email failures, matching, incidents and FileMaker; baseline volumes | Operator queues with ownership; operations email notices (`OPS_ALERT_EMAILS`) |
| G-06 | Sign-off of the renewal and pause edges: token rotation on renewal, QR link lifetime starting at issue, what a blocked record's customer sees, overdue reminders after a pause | All four built as proposed (section 2). A blocked record's customer sees the same neutral page as any expired link, with a help path (`SURVEY_HELP_EMAIL`) |
| G-07 | Data retention and access rules, including how long case notes are kept (P-07); backup capability and RPO/RTO | Restore drill script (`npm run restore-drill`) ready; needs an empty drill database |
| G-08 | Sender domain, SendGrid keys, webhook key, internal test allowlist | SendGrid transport, signed webhook, Test-mode allowlist |
| G-09 | FileMaker endpoint and privileges, field map, source marker, sandbox copy | Bridge framework with read-back, replay and conflict handling; writes stay off (SR-41..43) |
| G-10 | Approval of the in-house builder (no paid authoring tool was added) | Builder with drag and drop, preview and versioned publishing (SR-44) |
| G-11 | Any recovered meeting transcript, reviewed for conflicts | - |
| G-12 | Confirmation of who owns legacy unresolved cases until handoff | Legacy case import and audited handoff (SR-46) |

Production also needs a server or hosting, a domain, automated database backups and an uptime monitor on `/api/health`.

## 2. Proposals to confirm

| Area | Working assumption |
| --- | --- |
| Shop modes | A shop that has gone Live cannot return to Test; Paused shops still send renewals and PSG-approved alert emails |
| Reminders | Overdue reminders after a pause wait for PSG to release them |
| Links | Renewal revokes the old link, at most 3 renewals; a printable link's lifetime starts when it is issued |
| Imports | A production import needs a verified survey version |
| Public form | All identifying fields are optional |
| Alerts | Every submitted response with an alert gets a case, duplicates included; a correction after approval sends the case back to review, with no automatic resend |
| Outcomes | Resolution outcomes: resolved with customer, customer unreachable, no action needed; suppression results: applied, not needed |
| Suppression | A suppression change is overdue 24 hours after it is raised |
| Legacy cases | Visible to PSG only, not to shops |
| Case notes (P-07) | Shop notes and PSG notes marked for the shop are visible to the shop; PSG internal notes never are. A shop keeps seeing a case it was shown, with its notes, even when a correction sends it back to PSG review or PSG dismisses it later |
| Launch | A shop's first switch to Live needs every readiness check, PSG acceptance last. Resuming a paused shop does not |
| Opt-outs | A shop's existing opt-out list is imported as its own file type (production data only); each address is recorded once per shop |
| Customer help | Customers whose expired link cannot be renewed are pointed to `SURVEY_HELP_EMAIL` when PSG sets one, otherwise to the shop |
| Deleting a shop | The shop is archived, never erased (PDF 09: do not delete records). Refused while Live or while emails wait to send; recorded in the audit history |
| Monitoring | Stuck-email notice after 15 minutes; error spike at 5 failures in 15 minutes; repeat hourly; daily counts after 07:00 New York time |
| Dashboard | Charts use days for ranges up to 6 weeks, weeks up to about 7 months, then months; shares (0 to 1) are shown as percentages, stored values unchanged |
| Capacity | Save and submit p95 within 2 s, results on the dashboard within 5 s, each eligible email within 5 minutes (PDF 07 proposals) |

## 3. Changes to confirm under change control

- **Scope order.** At the user's request the survey builder (R2, SR-44) was built early, so the real PSG questions can be entered as soon as they arrive.
- **Separate application (P-01, SR-01).** The package assumes the survey is built inside the existing Hub, reusing its sign-in. No Hub code base was available, so this is its own Next.js application and database with its own sign-in (Better Auth), PSG roles and shop memberships. Everything else in P-01 holds: one application, one database, a transactional outbox. Joining it to the Hub later means mapping users and roles; nothing in the survey data depends on the sign-in system.
- **Interface shape (PDF 05).** Screens call server actions rather than a public JSON API, so the HTTP details of PDF 05 (status codes 409/410/422/429/202, a JSON error envelope, an `Idempotency-Key` header) do not apply to them; the same behaviour is kept inside: revision checks on every change, request keys on every submit, one result for a repeated submit, and the same key with different answers refused. The routes a third party calls follow the contract: the signed SendGrid webhook, `/api/health` and the CSV exports. Imports and exports run immediately rather than as background jobs, because files are capped at 5 MB and 5,000 rows. Work items (emails, alert cases, suppression changes, bridge events) each have their own durable table instead of one shared event table.

## 3a. Known limits, recorded rather than built

| Area | Limit | Why |
| --- | --- | --- |
| FileMaker bridge | No dry-run or reconciliation report yet (PDF 09 R2 steps 2 and 5), no switch from manual suppression to bridge-written suppression (step 6), and no periodic re-check of records already confirmed. Tests for a wrong legacy shop and the suppression switch wait for the same | They need the approved field map and a sandbox (G-09). The outbox, read-back check, conflict quarantine and retirement are built and tested |
| Bridge versions | A record's version is `revision × 1000 + match revision`, so ordering assumes fewer than 1,000 re-matches of one response | Far beyond any real use; revisit if the bridge goes live for years |
| Public form | Rate limits only (per address and per shop), no captcha or hidden trap field | No abuse seen yet; add one if spam appears |
| Mode switching in the browser | Pause and Resume are tested in the database tests only: no shop can go Live in the browser tests until verified PSG content exists (G-01) | Add a browser test once the real survey is published |
| CI browser tests | The CI workflow now runs the full browser suite against a production build; it has not run on GitHub yet | Confirm on the first push |

## 3b. Added at PSG's request (beyond the package wording)

| Feature | Where | Safeguards |
| --- | --- | --- |
| Responses CSV: one response, the ticked rows, or every row the filters match | Responses list and a response's page (`/psg/responses/export`) | PSG staff only; audited as `responses.exported`; formula-safe cells; "Export selected" with nothing ticked exports no rows. Test rows are included and marked `test_data`, as on the list |
| Operator queue CSV | Operator queues (`/psg/operations/export`) | PSG staff only; audited as `operator_queue.exported` |
| Search, filters, sort and page size on the PSG lists; headline counts | Most PSG pages | Read only. Overview, Shops and Imports totals exclude test data (SR-03); the counts on work queues (responses, alerts, email, suppression) count every item the list shows, test items included and marked, as the lists always have |
| Development database prune | `npm run db:prune [N]`, worker job when `DEV_PRUNE_KEEP` is set | Development only: refuses `NODE_ENV=production`, real email sending (`EMAIL_PROVIDER` other than `log`), and any database holding a Live or Paused shop or a real response |

## 4. Demo data

`npm run seed:dashboard` (or `npm run seed:dashboard -- --responses 180` for a smaller set) fills an internal test shop, *Demo Collision (internal test)*, for demonstrations and training. It goes through the normal code, never touches production shops, never counts in production reports, and refuses to run in production. It adds:

- six months of dummy responses (online, paper and public) from the demo TEST survey, with the alerts they raise;
- a year of dummy history before that, standing in for the Supabase history (G-03), on its own scales;
- the sample visit file below as a test import. Its rows show every hold reason: a duplicate visit, a bad date, missing emails, and addresses not on **Test recipients**.

`docs/sample-data/` holds dummy files in the expected columns until PSG sends real exports (G-02, G-12): `visits.csv`, `legacy-ledger.csv`, `legacy-cases.csv` and `opt-outs.csv`. Legacy files are production evidence, so the app refuses them for a test shop; try them on a throwaway development shop only.
