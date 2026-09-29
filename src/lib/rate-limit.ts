import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";

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

const ADDRESS_RE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Client address for rate limiting. A client can put anything at the start of
 * X-Forwarded-For, so only the entry our own proxies appended is trusted: the
 * one `hops` places from the end. Anything that is not an IP address is ignored.
 */
export function clientAddress(headers: Headers, hops = env().TRUSTED_PROXY_HOPS): string {
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = chain.length > 0 ? chain[Math.max(0, chain.length - hops)] : headers.get("x-real-ip")?.trim();
  return candidate && ADDRESS_RE.test(candidate) ? candidate : "unknown";
}
