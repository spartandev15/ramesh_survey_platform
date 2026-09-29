import { defineConfig } from "@playwright/test";

/**
 * Browser end-to-end tests (PDF 07: one primary seam through the real app and
 * database). They run against an already running app, e.g. `npm run dev`,
 * with a PSG admin account:
 *
 *   E2E_EMAIL=admin@example.com E2E_PASSWORD=... npm run test:e2e
 *
 * They create TEST data that cannot be deleted (published versions are
 * immutable), so point them at a development database, never production.
 */
// Local test account credentials, if present (gitignored). Explicit env vars win.
try {
  if (!process.env.E2E_EMAIL) process.loadEnvFile(".env.e2e.local");
} catch {
  // No local file: tests that need sign-in are skipped.
}
// The app's own settings, for tests that inspect the database (DATABASE_URL) or sign links.
try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env: database-backed browser tests are skipped.
}

export default defineConfig({
  testDir: "e2e",
  // Dev mode compiles each route on first visit.
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // The installed Google Chrome; in CI run `npx playwright install chrome` first.
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
