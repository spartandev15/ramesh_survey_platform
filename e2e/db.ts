import { createHash, createHmac } from "node:crypto";
import { Client } from "pg";

/**
 * Direct database access for browser tests that must inspect the ledger or
 * move a clock (for example, expire a link). Development databases only.
 */
export async function withDb<T>(body: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await body(db);
  } finally {
    await db.end();
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Same derivation and format as src/modules/email-ledger (opt-out-token.ts, dispatcher.ts). */
export function optOutToken(invitationId: string): string {
  const secret = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update("survey-opt-out-key").digest("hex");
  const mac = createHmac("sha256", secret).update(`survey-opt-out:v1:${invitationId}`).digest("base64url").slice(0, 32);
  return `${invitationId}.${mac}`;
}

/** Wait until the running worker has moved an email to one of the given states. */
export async function waitForIntent(db: Client, sql: string, params: unknown[], states: string[], timeoutMs = 150_000): Promise<string> {
  const start = Date.now();
  for (;;) {
    const { rows } = await db.query<{ state: string }>(sql, params);
    if (rows[0] && states.includes(rows[0].state)) return rows[0].state;
    if (Date.now() - start > timeoutMs) throw new Error(`Email did not reach ${states.join("/")}; last state ${rows[0]?.state ?? "none"}. Is \`npm run worker\` running?`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
