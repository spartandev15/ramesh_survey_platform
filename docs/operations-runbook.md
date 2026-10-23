# Operations runbook

How to run PSG Hub Surveys in production and what PSG operations does each day. It follows the package's *09 Operations, release and cutover* and names the screen for every step.

## 1. What runs

| Process | Command | What it does |
| --- | --- | --- |
| Web app | `npm run build` then `npm run start` | Staff pages, shop dashboards, customer surveys, APIs |
| Worker | `npm run worker` locally; `node --conditions=react-server --import tsx src/worker/index.ts` in production (no npm process kept in memory) | Sends survey and alert emails, schedules reminders, runs the FileMaker bridge when it is switched on, sends operations notices |
| Migrations | `npm run db:migrate` | Applies the SQL in `drizzle/` in order; run before starting a new release |

Run exactly one or more workers next to the web app. Several workers are safe: every send is claimed with a lease, and notices and the daily report are sent once. **Restart the worker after every deploy**: it does not reload code.

## 2. Configuration

All settings are environment variables; `.env.example` lists them.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 17 connection |
| `APP_URL` | Public address of the app, used in email links |
| `BETTER_AUTH_SECRET` | At least 32 random characters |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `SENDGRID_API_KEY` | `sendgrid` in production; `log` prints emails locally |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | Signed delivery events; without it the webhook refuses every event |
| `OPS_ALERT_EMAILS` | PSG operations addresses (comma separated) for stuck-queue notices and the daily counts |
| `SURVEY_HELP_EMAIL` | Optional help address shown to customers whose expired link cannot be renewed; otherwise they are told to contact the shop |
| `TRUSTED_PROXY_HOPS` | Proxies in front of the app that add to `X-Forwarded-For` (default 1). Run the app behind one reverse proxy that **overwrites** the header with the client address (nginx `proxy_set_header X-Forwarded-For $remote_addr;`) and never expose the app port directly: Next.js keeps a header the client sent, so without the proxy one client can dodge every per-address rate limit, sign-in included |
| `OPT_OUT_SECRET` | Optional signing key for opt-out links. Set it before ever rotating `BETTER_AUTH_SECRET`; links signed with the older key keep working |
| `LOG_LEVEL` | `info` in production |
| `DEV_PRUNE_KEEP` | Development only: the worker keeps the newest N rows per growing table (every 15 minutes). **Never set it in production.** The prune also refuses any database with a Live or Paused shop or a real (non-test) response, and never runs with `NODE_ENV=production` or `EMAIL_PROVIDER=sendgrid` |

In production, survey links are removed from logs automatically.

## 3. Monitoring

- **Uptime monitor:** point it at `GET /api/health` every minute. It answers `200 {"status":"ok"}`, or `503` when the database is unreachable or the worker has not beaten for five minutes. A stopped worker cannot email about itself, so this is the only alarm for that case.
- **Queue-health email (every 5 minutes):** sent to `OPS_ALERT_EMAILS` when survey emails have been due for 15 minutes or more, when five or more emails fail, bounce or end unknown within 15 minutes, or when a FileMaker bridge record fails or conflicts. It repeats hourly while the problem lasts and sends one "Resolved" email when it clears.
- **Daily counts email (after 07:00 New York time):** yesterday's imports, invitations, emails accepted by kind, responses by source and alerts raised, and everything waiting for a person, with the screen to use. Compare it with the import files and SendGrid's own statistics.
- **Overview page (`/psg`):** the same health at a glance: email queue, worker heartbeat, bridge.

Thresholds are the package's proposals; PSG confirms the real ones at kickoff (see [open-items.md](open-items.md)).

## 4. Daily operating loop

Work top to bottom. Every list is paged; test data is hidden unless you ask for it.

1. **Operator queues** (`/psg/operations`): everything that failed or waits for a person, oldest first. Take ownership, open the item, fix it on its own page.
2. **Imports** (`/psg/imports`): rows held for date or email are fixed in **Invitations** (Held tab). Fixing never sends by itself; check legacy coverage before any manual send. File rows that never became a visit (unclear visit identity, failed rows) sit in the operator queue: get the corrected row from the shop, import it again, then mark the row reviewed with what you did. Files that could not be read at all are listed under *Files that could not be read*; nothing from them was staged.
3. **Alert review** (`/psg/alerts`): negative feedback waits here. Check the match and source, adjust recipients, **Approve & send**, then watch **Email review** for the delivery result.
4. **Responses** (`/psg/responses`): match unmatched responses to their visit and settle duplicates. Originals are kept; every change is audited.
5. **Suppression queue** (`/psg/suppression`): routine-mail changes to make by hand in FileMaker before the next mail run. Acknowledge each one with what you did. If you cannot, stop that mail run through its owner; never mark it done.
6. **Email review** (`/psg/email`): acceptance unknown, bounced and failed emails. Check the provider first, then choose *Provider shows it was sent*, *Provider has no record: send it*, *Try again* (failed) or *Release to send* (held), with a note where asked. Never reset reminder counts.
7. **Follow-up closure**: shops ask to close a case; only PSG resolves it, with an outcome.

## 5. Launching a shop

1. **Shops → the shop**: set branding, delivery cutoff, survey version, reminder delay, link lifetime and alert recipients. New shops start in Test mode; Test mode only emails addresses on **Test recipients**.
2. **Imports**: load the shop's existing opt-out list (*Existing opt-out list*, production data), and its legacy survey history, before any visit import.
3. **Launch readiness** (`/psg/readiness`): every shop's checklist. Record each manual check with a note; the last check, *PSG accepted for launch*, is refused while anything else fails. **Export CSV** keeps the whole manifest as launch evidence.
4. Switch to **Live** on the shop page. The first switch is refused until the checklist is complete. The summary shows the survey version, cutoff, and how many waiting invitations are eligible, held or excluded and how many people they reach. Nothing is sent in bulk by the switch: waiting invitations are selected deliberately in **Invitations**.
5. After launch, read back the first real results: a provider receipt, a saved response, the shop's dashboard and one approved alert.

## 5a. Before the first production release

Confirm each line and keep the answers with the release note ([release-notes.md](release-notes.md)).

1. Migrations applied to the production database (`npm run db:migrate`); the previous build is kept for rollback (section 6).
2. Automated backups with point-in-time recovery are on, and a restore drill has passed on a copy (section 7).
3. Sender domain authenticated in SendGrid (SPF, DKIM, DMARC); `EMAIL_PROVIDER=sendgrid`; `SENDGRID_WEBHOOK_PUBLIC_KEY` set and the SendGrid Event Webhook pointed at `/api/survey-mail/events` with signing on.
4. The worker runs as a service that restarts by itself; `/api/health` answers 200 and an uptime monitor watches it; `OPS_ALERT_EMAILS` set.
5. **Test recipients** holds only internal addresses.
6. Named people are on the roster below, with a backup each, and can open **Operator queues**.
7. **Internal production smoke test**, on an internal test shop, never a customer: import one visit to an allowlisted address, receive the email, answer with a low rating, see the result on the shop dashboard, approve the alert and receive it, and see both emails as *Delivered* in **Email review**. Then check the daily counts email the next morning.

## 5b. Owners and escalation

Launch needs real names here (PDF 09; gate G-05). Fill this in with PSG and keep it current.

| Area | Owner | Backup | Escalate to |
| --- | --- | --- | --- |
| Product acceptance and launch sign-off | | | |
| Imports and held rows | | | |
| Alert review | | | |
| Suppression changes in FileMaker | | | |
| Email failures and provider | | | |
| Matching and duplicates | | | |
| Incidents and outages | | | |
| FileMaker bridge | | | |

## 5c. Handing over legacy unresolved cases

For open follow-up cases from the old system (SR-46; owner until handoff: G-12).

1. Get the export of open and closed legacy cases from the legacy owner.
2. **Imports → Legacy follow-up cases**: upload it, check the preview (closed cases are kept for reference only; a repeated case ID is refused) and commit. Nothing is emailed.
3. Agree the handoff time with the legacy owner. Until then the legacy owner keeps working the case; a re-import updates it and never creates a second one.
4. **Legacy cases** (`/psg/legacy-cases`): take each case over with a note at the agreed time. After handoff, only Hub works it and re-imports leave it unchanged, so there is no duplicate outreach.
5. Reconcile: the number of open cases in the legacy system at handoff equals the cases Hub took over plus those still with the legacy owner. The operator responsible records acceptance in the case notes.

## 6. Pause and rollback

- A delivery problem: set the affected shop to **Paused**. Nothing new is sent; customers who already have a link can still finish.
- Do not delete records, reset invitations or resend mail to recover. Reconcile every acceptance-unknown email in **Email review** before resuming.
- A software rollback keeps the database as it is (all migrations are additive) and restarts web and worker on the previous build.
- Returning to Alchemer or FileMaker invitations is not automatic; it needs a reconciled visit ledger and an explicit decision.

## 7. Backup and restore

- Take automated PostgreSQL backups with point-in-time recovery (proposed RPO 15 minutes, RTO 4 hours; PSG to confirm).
- Prove a restore regularly: an administrator creates an empty database once (`createdb -U postgres -O psg psg_survey_drill`), then run `DRILL_DATABASE_URL=... npm run restore-drill`. It backs up the live database, restores the copy into the drill database, checks that key table counts match and that the data guards (append-only history, locked answers) came back, and prints the backup and restore times. It never writes to the live database.
- After a restore, start the worker last and review **Email review** before it sends anything.

## 8. FileMaker bridge (R2)

The bridge page (`/psg/bridge`) stays **Off** until a FileMaker connection is configured and four checks are recorded in order: field map approved, legacy alerts skip Hub records, sandbox write tested, writes switched on. Withdrawing any check switches writes off. Hub stays the owner; a record counts as sent only when FileMaker gives back exactly what Hub wrote. Records changed in FileMaker are held for a person and never overwritten.

**Retirement** happens only when every FileMaker report, mail run or screen that uses the bridge is replaced or no longer needed, nothing is waiting, and no suppression change is outstanding. Signing it switches writes off; records and history stay.

## 9. Capacity check

`npm run load-test -- --customers 200 --concurrency 25 --emails 100` runs against an internal test shop and fails when a target is missed or any answer or email is lost or duplicated. Repeat it at twice PSG's measured peak before committing production capacity.
