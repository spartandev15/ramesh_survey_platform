import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/**
 * Fixed-window rate limit shared by every app instance through the database
 * (PDF 04: rate limits on token checks, public submission and renewal).
 * Keys are prefixed so they never collide with Better Auth's entries in the same table.
 * Returns true when the request is allowed.
 */
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const id = `psg:${key}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const db = getDb();
  // The table has two unique columns (id and key), and one upsert can only handle a clash on one of them.
  // So: create the row if nobody has, ignoring any clash, then count on the existing row. Simultaneous
  // first requests (a double click) are all counted and none fails (found by the load test).
  const created = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit (id, key, count, last_request) VALUES (${id}, ${id}, 1, ${now})
    ON CONFLICT DO NOTHING
    RETURNING count
  `);
  if (created.rows.length > 0) return 1 <= limit;
  const updated = await db.execute<{ count: number }>(sql`
    UPDATE rate_limit SET
      count = CASE WHEN last_request < ${windowStart} THEN 1 ELSE count + 1 END,
      last_request = CASE WHEN last_request < ${windowStart} THEN ${now} ELSE last_request END
    WHERE id = ${id}
    RETURNING count
  `);
  return Number(updated.rows[0]?.count ?? 0) <= limit;
}

/** Client address for rate limiting. Trusts the first X-Forwarded-For hop set by the deployment's proxy. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
