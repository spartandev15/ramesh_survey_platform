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
  const result = await getDb().execute<{ count: number }>(sql`
    INSERT INTO rate_limit (id, key, count, last_request)
    VALUES (${id}, ${id}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit.last_request < ${windowStart} THEN 1 ELSE rate_limit.count + 1 END,
      last_request = CASE WHEN rate_limit.last_request < ${windowStart} THEN ${now} ELSE rate_limit.last_request END
    RETURNING count
  `);
  return Number(result.rows[0]?.count ?? 0) <= limit;
}

/** Client address for rate limiting. Trusts the first X-Forwarded-For hop set by the deployment's proxy. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
