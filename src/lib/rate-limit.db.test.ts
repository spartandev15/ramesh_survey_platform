/**
 * Database test for the shared rate limit (SR-40, SR-48): simultaneous first
 * requests for one key (a double click, many tabs) are all counted and none
 * fails. Found by the load test.
 */
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("rate limit under concurrency", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { consumeRateLimit } = await import("./rate-limit");
  const { sql } = await import("drizzle-orm");
  const prefix = `test:concurrent:${Date.now()}:${Math.random()}`;

  afterAll(async () => {
    await getDb().execute(sql`DELETE FROM rate_limit WHERE id LIKE ${`psg:${prefix}%`}`);
    await getPool().end();
  });

  it("counts simultaneous first requests without an error, and stops the ones over the limit", async () => {
    // The race only shows when first requests for a fresh key collide, so try many fresh keys at once.
    const rounds = await Promise.all(
      Array.from({ length: 30 }, (_, k) => Promise.all(Array.from({ length: 8 }, () => consumeRateLimit(`${prefix}:${k}`, 6, 60)))),
    );
    for (const results of rounds) {
      expect(results.filter(Boolean)).toHaveLength(6);
      expect(results.filter((allowed) => !allowed)).toHaveLength(2);
    }
  });
});
