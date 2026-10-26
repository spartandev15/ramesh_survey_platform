# Operations runbook

How to run PSG Hub Surveys in production and what PSG operations does each day. It follows the package's *09 Operations, release and cutover* and names the screen for every step.

## 1. What runs

| Process | Command | What it does |
| --- | --- | --- |
| Web app | `npm run build` then `npm run start` | Staff pages, shop dashboards, customer surveys, APIs |
| Worker | `npm run worker` locally; `node dist/worker.mjs` in production (one bundled file from `npm run build:server`; about 70 MB of memory) | Sends survey and alert emails, schedules reminders, runs the FileMaker bridge when it is switched on, sends operations notices |
| Migrations | `npm run db:migrate` locally; `node dist/migrate.mjs` in the image | Applies the SQL in `drizzle/` in order; run before starting a new release |

Run at least one worker next to the web app. Several workers are safe: every send is claimed with a lease, and notices and the daily report are sent once. **Restart the worker after every deploy**: it does not reload code. `docker-compose.yml` restarts the database, web app and worker by themselves after a crash or a reboot (`restart: unless-stopped`); without Docker, run them as services that do the same (for example systemd with `Restart=always`).

### 1a. Shared cPanel hosting (CloudLinux "Setup Node.js App")

Used for the test deployment at `survey.spartanbots.xyz` (Namecheap shared hosting). A VPS with Docker remains the recommended production setup.

- **Database:** the host's own PostgreSQL is too old (10; the app needs 13 or later), so the database is an external PostgreSQL (Supabase, *Session pooler* address, port 5432). Shared hosts block outgoing database ports by default: ask the host to open outbound TCP 5432. Use verified TLS: download the provider's CA file next to the app and end `DATABASE_URL` with `?sslmode=verify-full&sslrootcert=/full/path/to/ca.crt`. On Supabase, switch the Data API off and revoke the `anon` and `authenticated` roles' rights on the app's tables (Supabase grants them by default).
- **Files:** build on a development machine (`npm run build`, `npm run build:server`), then copy `.next/standalone` (without its `.env` and without `node_modules/@img` and `node_modules/sharp`), `.next/static`, `public`, `dist/*.mjs`, `drizzle/` and the two files in `deploy/shared-hosting/` into one folder outside the web root, for example `~/psg-survey-app`.
- **Settings:** write `.env` in that folder with `chmod 600` (generate the secrets on the server). `app.js` loads it before starting the server, so no secret is typed into the control panel.
- **App:** create the Node.js app (Node 24, application root = that folder, the subdomain, startup file `app.js`, production mode), for example `cloudlinux-selector create --interpreter nodejs --version 24 --app-root psg-survey-app --domain <subdomain> --app-uri / --app-mode production --startup-file app.js`. The selector refuses a folder that already holds `node_modules`: rename it for the create and rename it back afterwards. It writes only a `.htaccess` into the subdomain folder.
- **Migrations and first admin:** `node --env-file=.env dist/migrate.mjs`, then `node --env-file=.env dist/create-admin.mjs <email> "<name>" > admin-password.txt` with `umask 077`; the admin reads the file once and deletes it.
- **Worker:** shared hosting may stop long-running processes, so cron runs `worker-keepalive.sh` every minute; it starts the worker only when it is not running. `/api/health` reports a stopped worker.
- **Update:** upload the new files, run migrations, then `cloudlinux-selector restart --interpreter nodejs --app-root psg-survey-app` and stop the worker (`kill $(cat worker.pid)`) so cron starts the new one.

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
- **Daily counts email (first run after 07:00 New York time):** the last 24 hours of imports, invitations, emails accepted by kind, responses by source and alerts raised, and everything waiting for a person, with the screen to use. Compare it with the import files and SendGrid's own statistics.
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

1. The exact commit being released is recorded, and its migration and sign-in changes were reviewed by the people PSG names for that (PDF 09).
2. Migrations applied to the production database (`node dist/migrate.mjs`, or `npm run db:migrate` from a checkout); the previous build is kept for rollback (section 6).
3. Backups meet the agreed recovery point (section 7) and a restore drill has passed on a copy.
4. Sender domain authenticated in SendGrid (SPF, DKIM, DMARC); `EMAIL_PROVIDER=sendgrid`; `SENDGRID_WEBHOOK_PUBLIC_KEY` set and the SendGrid Event Webhook pointed at `/api/survey-mail/events` with signing on. With `EMAIL_PROVIDER=log` nothing reaches customers or staff, and password-reset links cannot be delivered.
5. The web app and worker run as services that restart by themselves; `/api/health` answers 200 and an uptime monitor watches it; `OPS_ALERT_EMAILS` set.
6. **Test recipients** holds only internal addresses.
7. Named people are on the roster below, with a backup each, can open **Operator queues** and have been shown the daily loop (section 4).
8. **Launch readiness** reviewed for every shop, and its CSV export kept with the release record.
9. **Internal production smoke test**, on an internal test shop, never a customer: import one visit to an allowlisted address, receive the email, answer with a low rating, see the result on the shop dashboard, approve the alert and receive it. Check the alert's delivery on its case page and that **Email review** and **Operator queues** show nothing stuck. Then check the daily counts email the next morning.
10. The release record (commit, checks above, readiness export, contacts) is delivered to PSG.

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
5. Reconcile: the number of open cases in the legacy system at handoff equals the cases Hub took over plus those still with the legacy owner. The operator responsible records acceptance in the handoff note and, after handoff, in the case notes (notes are refused before handoff).

## 6. Pause and rollback

- A delivery problem at one shop: set it to **Paused**. Invitations and reminders stop; link renewals a customer asks for and alert emails PSG approves still go out, and customers who already have a link can still finish.
- A problem with sending itself (every shop): stop the worker. Nothing is sent while it is stopped; queued emails wait and go out when it starts again, so review **Email review** first. `/api/health` reports the stopped worker.
- Tell affected shops through the owner PSG names for incidents (roster below) whenever surveys or alerts are interrupted.
- Do not delete records, reset invitations or resend mail to recover. Reconcile every acceptance-unknown email in **Email review** before resuming.
- A software rollback keeps the database as it is (all migrations are additive) and restarts web and worker on the previous build.
- Returning to Alchemer or FileMaker invitations is not automatic; it needs a reconciled visit ledger and an explicit decision.

## 7. Backup and restore

- The package proposes a recovery point of 15 minutes and a recovery time of 4 hours (PSG to confirm). Only point-in-time recovery meets that: use a managed PostgreSQL with it switched on, or set up WAL archiving on your own server.
- `deploy/backup.sh` (a daily `pg_dump` from cron, 14 days kept) is a fallback, not the target: it can lose up to a day of answers, which PSG has to accept in writing if it is the only backup. It writes files only its user can read; keep `DATABASE_URL` in a `chmod 600` file (`BACKUP_ENV_FILE`), never on the cron line. Copy the folder off the server, encrypted, as well.
- Put `deploy/nginx.conf` in front of the app: HTTPS, it overwrites `X-Forwarded-For` so rate limits see the real client address, and its access log leaves out survey and password-reset tokens.
- Prove a restore regularly: an administrator creates an empty database once (`createdb -U postgres -O psg psg_survey_drill`), then run `DRILL_DATABASE_URL=... npm run restore-drill`. It backs up the live database, restores the copy into the drill database, checks that key table counts match and that the data guards (append-only history, locked answers) came back, and prints the backup and restore times. It never writes to the live database.
- After a restore, start the worker last and review **Email review** before it sends anything.

## 8. FileMaker bridge (R2)

The bridge page (`/psg/bridge`) stays **Off** until a FileMaker connection is configured and four checks are recorded in order: field map approved, legacy alerts skip Hub records, sandbox write tested, writes switched on. Withdrawing any check switches writes off. Hub stays the owner; a record counts as sent only when FileMaker gives back exactly what Hub wrote. Records changed in FileMaker are held for a person and never overwritten.

**Retirement** happens only when every FileMaker report, mail run or screen that uses the bridge is replaced or no longer needed, nothing is waiting, and no suppression change is outstanding. Signing it switches writes off; records and history stay.

## 9. Capacity check

`npm run load-test -- --customers 200 --concurrency 25 --emails 100` runs against an internal test shop and fails when a target is missed or any answer or email is lost or duplicated. Repeat it at twice PSG's measured peak before committing production capacity.
