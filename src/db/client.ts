import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logger } from "@/lib/logger";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle, for functions that must run inside a caller's transaction. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Reuse one pool per process, including across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { psgPool?: Pool; psgDb?: Database };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  // A blank or invalid DATABASE_POOL_MAX keeps the default instead of a pool of zero.
  // Idle connections close after pg's default 10 seconds: on shared hosting, keeping them for minutes made
  // sign-ins hang (most likely connections cut without notice). Waiting for a connection gives up after 15 seconds
  // instead of hanging a page. Idle connections do not keep a finished script running.
  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  });
  // The database (or its pooler) may close an idle connection; without a listener that error stops the process.
  pool.on("error", (error) => logger.warn({ err: error }, "idle database connection closed"));
  return pool;
}

export function getPool(): Pool {
  globalForDb.psgPool ??= createPool();
  return globalForDb.psgPool;
}

/**
 * Shared Drizzle instance. Use only the core query builder and `db.transaction`
 * (not the `db.query` relational API) so the Drizzle v1 upgrade stays drop-in.
 */
export function getDb(): Database {
  globalForDb.psgDb ??= drizzle(getPool(), { schema });
  return globalForDb.psgDb;
}

/**
 * Await queries one after another. A transaction uses one connection, so its
 * queries must not run in parallel (Promise.all would overlap them). Drizzle
 * queries start only when awaited, so pass them unawaited here.
 */
export async function inOrder<T extends readonly unknown[]>(queries: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results: unknown[] = [];
  for (const query of queries) results.push(await query);
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
}
