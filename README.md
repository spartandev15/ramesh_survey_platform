# PSG Survey Platform

Shop-branded customer survey platform for Phoenix Solutions Group, built to the
*PSG Survey Development Requirements Package v1.0* (requirements SR-01 to SR-48).

## Stack

Node.js 24, TypeScript, Next.js 16 (web + API), PostgreSQL 17, Drizzle ORM,
Better Auth, pg-boss (background jobs), Zod, React Hook Form, Tailwind CSS,
Vitest. Deployed as one Docker image that runs as `web`, `worker` or `migrate`.

## Local setup

Requirements: Node.js 24+, and PostgreSQL 17 (local install, Docker, or a hosted
database such as Supabase).

```bash
npm install
cp .env.example .env          # then fill in BETTER_AUTH_SECRET and DATABASE_URL
docker compose up -d db       # optional: local Postgres via Docker
npm run db:migrate            # apply SQL migrations
npm run create-admin -- you@example.com "Your Name"
npm run seed:demo             # optional: demo survey (TEST content, not the PSG instrument)
npm run dev                   # http://localhost:3000
npm run worker                # background jobs, in a second terminal
```

With `EMAIL_PROVIDER=log`, emails such as password resets are printed to the
server log instead of being sent.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run worker` | Background job worker |
| `npm test` | Unit tests, plus database tests when `.env` has `DATABASE_URL` (they roll back) |
| `npm run test:e2e` | Browser tests against a running app (see below) |
| `npm run typecheck` | TypeScript check (run `npx next typegen` first on a fresh clone) |
| `npm run lint` | ESLint |
| `npm run db:generate` | Create a migration after changing `src/db/schema` |
| `npm run db:migrate` | Apply migrations |
| `npm run create-admin` | Create or promote a PSG administrator |
| `npm run seed:demo` | Load the demo survey and publish it as a test version |

## Browser tests

`npm run test:e2e` drives the real app in Google Chrome: a PSG admin builds,
previews and publishes a survey, issues a test link, completes it as a signed-out
respondent on a phone viewport, and checks the scored result. Start the app
first (`npm run dev`), load the demo survey once (`npm run seed:demo`), then:

```bash
E2E_EMAIL=you@example.com E2E_PASSWORD=... npm run test:e2e
```

The tests create TEST data that cannot be deleted (published versions are
immutable). Run them against a development database only.

## Project layout

```
src/
  app/              Routes: (auth) sign-in pages, psg/ PSG workspace, shop/[shopId]/ shop workspace,
                    survey/[token] public respondent survey (no login)
  components/       Shared UI
  db/               Drizzle schema and client
  lib/              Env validation, logger
  modules/          Business modules; each owns its logic and data access
    access/         Roles, capabilities, tenant checks
    audit/          Append-only audit log
    auth/           Better Auth setup
    instruments/    Survey definitions, versioning and the server-side evaluator
    responses/      Invitations, access tokens, autosave and submission
    email/          Provider adapters (log, SendGrid)
    shops/          Shop management
  worker/           Background job process
drizzle/            Committed SQL migrations
scripts/            migrate, create-admin
```

## Rules that keep the system safe

1. **Authorize in every data function**, not only in layouts or `proxy.ts`.
   Use `requireCapability`, `requireShopRead` or the page guards. Another shop's
   data returns 404 (AT-01).
2. **Never trust client input for shop id, scores, alert class or roles.**
   Load them from the database on the server.
3. **Audit history is append-only.** The database rejects UPDATE/DELETE on
   `audit_event`. Write audit rows in the same transaction as the change.
4. **Email adapters never retry.** A timeout means "acceptance unknown" and must
   be reconciled, not resent (SR-23).
5. **Use Drizzle's core query builder and `db.transaction`**, not the `db.query`
   relational API, so the Drizzle v1 upgrade stays drop-in.
6. **Scores and alerts come only from `evaluateSubmission`.** Online, public
   and paper responses use the same evaluator; never accept a client score.
7. **Published survey versions are immutable.** The database rejects changes;
   create a new draft with `createDraftFrom`. Real PSG content is published
   with `isTest: false` only after PSG approves the source (gate G-01).
8. **Survey links are bearer tokens.** Store only `hashToken(token)`, never log or
   audit the token, and keep respondent pages free of third-party scripts.
   Submitted answers are locked by a database trigger; corrections append to
   `response_revision`.
9. **Schema changes go through migrations** (`db:generate`, review the SQL, commit).

## Deployment

Any host that runs Docker and can reach PostgreSQL 17: a VPS, AWS, Azure,
DigitalOcean, Render, Railway, Fly.io. Shared hosting is not supported because
the background worker must run continuously.

```bash
docker build -t psg-survey .
docker run --env-file .env psg-survey npm run db:migrate   # once per release
docker run --env-file .env -p 3000:3000 psg-survey         # web
docker run --env-file .env psg-survey npm run worker       # worker
```

Or run the whole stack on one server with `docker compose --profile app up -d`.

**Supabase** works as the database with no code change: set `DATABASE_URL` to the
direct or session-pooler connection string (not the transaction pooler).
