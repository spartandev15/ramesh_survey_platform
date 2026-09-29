# Open items and proposals

What is still open against the package, what PSG needs to decide or supply, and the working assumptions made so development could continue. Nothing here is hidden in the code: every proposal is a named constant or a documented rule that can change without rework.

## 1. Waiting on PSG data or access

| Gate | Needed from PSG | What is ready |
| --- | --- | --- |
| G-01 | The exact current survey: wording, option values, branching, required questions, scoring formulas, alert rules and precedence, plus signed golden examples | Survey builder, versioning, server-side scoring and alerts, golden-fixture tests. Only placeholder TEST content exists (SR-14). |
| G-02 | A sample of the real import file and confirmation of the visit key and repair-order reuse; the legacy sent-invitation ledger | Import with column mapping, dry-run preview, held reasons, legacy exclusion |
| G-03 | Access to the live Supabase history, shop mappings, counts and score scales | Read-only history storage, loader and display on its own scales (SR-30) |
| G-04 | The active routine-mail suppression rules, affected records, timing and the named operator | Suppression queue with acknowledgment evidence (SR-36) |
| G-05 | Named owners and backups for product acceptance, imports, alert review, suppression, email failures, matching, incidents and FileMaker; baseline volumes | Operator queues with ownership; operations email notices (`OPS_ALERT_EMAILS`) |
| G-07 | Data retention and access rules; backup capability and RPO/RTO | Restore drill script (`npm run restore-drill`) ready; needs an empty drill database |
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
| Deleting a shop | The shop is archived, never erased (PDF 09: do not delete records). Refused while Live or while emails wait to send; recorded in the audit history |
| Monitoring | Stuck-email notice after 15 minutes; error spike at 5 failures in 15 minutes; repeat hourly; daily counts after 07:00 New York time |
| Dashboard | Charts use days for ranges up to 6 weeks, weeks up to about 7 months, then months; shares (0 to 1) are shown as percentages, stored values unchanged |
| Capacity | Save and submit p95 within 2 s, results on the dashboard within 5 s, each eligible email within 5 minutes (PDF 07 proposals) |

## 3. Scope-order change

At the user's request the survey builder (R2, SR-44) was built early, so the real PSG questions can be entered as soon as they arrive. The client should be told about this change under change control.

## 4. Demo data

`npm run seed:dashboard` fills an internal test shop, *Demo Collision (internal test)*, for demonstrations and training. It goes through the normal code, never touches production shops, never counts in production reports, and refuses to run in production. It adds:

- six months of dummy responses (online, paper and public) from the demo TEST survey, with the alerts they raise;
- a year of dummy history before that, standing in for the Supabase history (G-03), on its own scales;
- the sample visit file below as a test import. Its rows show every hold reason: a duplicate visit, a bad date, missing emails, and addresses not on **Test recipients**.

`docs/sample-data/` holds dummy files in the expected columns until PSG sends real exports (G-02, G-12): `visits.csv`, `legacy-ledger.csv` and `legacy-cases.csv`. Legacy files are production evidence, so the app refuses them for a test shop; try them on a throwaway development shop only.
