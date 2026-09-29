# Operations runbook

How to run PSG Hub Surveys in production and what PSG operations does each day. It follows the package's *09 Operations, release and cutover* and names the screen for every step.

## 1. What runs

| Process | Command | What it does |
| --- | --- | --- |
| Web app | `npm run build` then `npm run start` | Staff pages, shop dashboards, customer surveys, APIs |
| Worker | `npm run worker` | Sends survey and alert emails, schedules reminders, runs the FileMaker bridge when it is switched on, sends operations notices |
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
| `LOG_LEVEL` | `info` in production |

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
2. **Imports** (`/psg/imports`): rows held for identity, date or email. Fix them in **Invitations** (Held tab). Fixing never sends by itself; check legacy coverage before any manual send.
3. **Alert review** (`/psg/alerts`): negative feedback waits here. Check the match and source, adjust recipients, **Approve & send**, then watch **Email review** for the delivery result.
4. **Responses** (`/psg/responses`): match unmatched responses to their visit and settle duplicates. Originals are kept; every change is audited.
5. **Suppression queue** (`/psg/suppression`): routine-mail changes to make by hand in FileMaker before the next mail run. Acknowledge each one with what you did. If you cannot, stop that mail run through its owner; never mark it done.
6. **Email review** (`/psg/email`): acceptance unknown, bounced and failed emails. Check the provider first, then choose *Provider shows it was sent*, *Provider has no record: send it*, *Try again* (failed) or *Release to send* (held), with a note where asked. Never reset reminder counts.
7. **Follow-up closure**: shops ask to close a case; only PSG resolves it, with an outcome.

## 5. Launching a shop

1. **Shops → the shop**: set branding, delivery cutoff, survey version, reminder delay, link lifetime and alert recipients. New shops start in Test mode; Test mode only emails addresses on **Test recipients**.
2. **Launch readiness** (`/psg/readiness`): every shop's checklist. Record each manual check with a note; the last check, *PSG accepted for launch*, is refused while anything else fails.
3. Switch to **Live** on the shop page. Nothing is sent in bulk by the switch: waiting invitations are selected deliberately in **Invitations**.
4. After launch, read back the first real results: a provider receipt, a saved response, the shop's dashboard and one approved alert.

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
