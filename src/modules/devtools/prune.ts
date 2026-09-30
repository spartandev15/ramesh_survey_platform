import { getPool } from "@/db/client";

/** Why a database must not be pruned: it holds real work. Null when it holds only test and demo data. */
export async function realDataReason(query: (sql: string) => Promise<{ rows: { live: boolean; real: boolean; mailed?: boolean }[] }>): Promise<string | null> {
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM shop_survey_settings WHERE mode <> 'test') AS live,
            EXISTS (SELECT 1 FROM survey_response WHERE NOT is_test) AS real,
            EXISTS (SELECT 1 FROM email_intent WHERE NOT is_test AND accepted_at IS NOT NULL) AS mailed`,
  );
  if (rows[0]?.live) return "a shop is Live or Paused";
  if (rows[0]?.real) return "it holds real (non-test) survey responses";
  if (rows[0]?.mailed) return "real customers were emailed from it";
  return null;
}

/**
 * Development only: keeps the local database small by holding each growing
 * table to its newest `keep` rows and deleting older rows together with
 * the rows that point at them. It lifts the append-only guards for its own
 * transaction only, which is why it refuses to run in production or with
 * real email sending, and on
 * any database that holds real work (a Live shop or a real response),
 * whatever NODE_ENV says.
 *
 *   npm run db:prune            (keeps 100)
 *   DEV_PRUNE_KEEP=100 in .env  (the worker then prunes every 15 minutes)
 */

/** Tables whose guards block deletes; their user triggers are off inside the prune transaction only. */
const GUARDED = ["survey_response", "response_revision", "match_decision", "suppression_action", "alert_approval", "case_note", "email_intent", "invitation", "audit_event", "historical_response"];

export function pruneKeep(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Why this process must not prune, from its settings alone: production, or real email sending. */
export function unsafeSettingsReason(settings: { nodeEnv: string | undefined; emailProvider: string | undefined }): string | null {
  if (settings.nodeEnv === "production") return "NODE_ENV is production";
  // Production always sends through SendGrid; only a local setup writes email to the log.
  if ((settings.emailProvider ?? "log") !== "log") return "email is sent for real (EMAIL_PROVIDER is not log)";
  return null;
}

export async function pruneDevData(keep: number): Promise<Record<string, number>> {
  const unsafe = unsafeSettingsReason({ nodeEnv: process.env.NODE_ENV, emailProvider: process.env.EMAIL_PROVIDER });
  if (unsafe) throw new Error(`Not pruning: ${unsafe}. pruneDevData is for development databases only.`);
  if (!Number.isInteger(keep) || keep < 1) throw new Error("keep must be a positive whole number");
  const client = await getPool().connect();
  const removed: Record<string, number> = {};
  const run = async (label: string, sql: string) => {
    const result = await client.query(sql, [keep]);
    if (label && result.rowCount) removed[label] = (removed[label] ?? 0) + result.rowCount;
  };
  try {
    await client.query("BEGIN");
    const blocked = await realDataReason((sql) => client.query(sql));
    if (blocked) throw new Error(`Not pruning: ${blocked}. This tool is for development databases only.`);
    // Fail fast instead of queueing behind a busy page or worker; the next run tries again.
    await client.query("SET LOCAL lock_timeout = '5s'");
    for (const table of GUARDED) await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);

    // Responses: the newest `keep` stay; older ones go with their alerts, matches and revisions.
    await run("", `CREATE TEMP TABLE prune_response ON COMMIT DROP AS SELECT id FROM survey_response ORDER BY coalesce(submitted_at, created_at) DESC, id OFFSET $1`);
    await run("", `CREATE TEMP TABLE prune_case ON COMMIT DROP AS SELECT id FROM alert_case WHERE response_id IN (SELECT id FROM prune_response) AND $1 > 0`);
    await run("", `CREATE TEMP TABLE prune_intent ON COMMIT DROP AS SELECT id FROM email_intent WHERE alert_approval_id IN (SELECT id FROM alert_approval WHERE case_id IN (SELECT id FROM prune_case)) AND $1 > 0`);
    await run("email_event", `DELETE FROM email_event WHERE email_intent_id IN (SELECT id FROM prune_intent) AND $1 > 0`);
    await run("email_intent", `DELETE FROM email_intent WHERE id IN (SELECT id FROM prune_intent) AND $1 > 0`);
    await run("alert_approval", `DELETE FROM alert_approval WHERE case_id IN (SELECT id FROM prune_case) AND $1 > 0`);
    await run("case_note", `DELETE FROM case_note WHERE case_id IN (SELECT id FROM prune_case) AND $1 > 0`);
    await run("alert_case", `DELETE FROM alert_case WHERE id IN (SELECT id FROM prune_case) AND $1 > 0`);
    await run("shop_suggestion", `DELETE FROM shop_suggestion WHERE response_id IN (SELECT id FROM prune_response) AND $1 > 0`);
    await run("suppression_action", `DELETE FROM suppression_action WHERE response_id IN (SELECT id FROM prune_response) AND $1 > 0`);
    await run("match_decision", `DELETE FROM match_decision WHERE (response_id IN (SELECT id FROM prune_response) OR other_response_id IN (SELECT id FROM prune_response)) AND $1 > 0`);
    await run("response_revision", `DELETE FROM response_revision WHERE response_id IN (SELECT id FROM prune_response) AND $1 > 0`);
    await run("survey_response", `DELETE FROM survey_response WHERE id IN (SELECT id FROM prune_response) AND $1 > 0`);

    // Invitations: the newest `keep` stay, and so does any a kept response answered.
    await run("", `CREATE TEMP TABLE prune_invitation ON COMMIT DROP AS SELECT id FROM (SELECT id FROM invitation ORDER BY created_at DESC, id OFFSET $1) old WHERE id NOT IN (SELECT invitation_id FROM survey_response WHERE invitation_id IS NOT NULL)`);
    await run("access_token", `DELETE FROM access_token WHERE invitation_id IN (SELECT id FROM prune_invitation) AND $1 > 0`);
    await run("email_event", `DELETE FROM email_event WHERE email_intent_id IN (SELECT id FROM email_intent WHERE invitation_id IN (SELECT id FROM prune_invitation)) AND $1 > 0`);
    await run("email_intent", `DELETE FROM email_intent WHERE invitation_id IN (SELECT id FROM prune_invitation) AND $1 > 0`);
    await run("", `UPDATE import_row SET invitation_id = NULL WHERE invitation_id IN (SELECT id FROM prune_invitation) AND $1 > 0`);
    await run("invitation", `DELETE FROM invitation WHERE id IN (SELECT id FROM prune_invitation) AND $1 > 0`);

    // Audit, history, sessions and finished jobs: the newest `keep` of each stay. Links and emails go only with their invitation or case.
    await run("audit_event", `DELETE FROM audit_event WHERE id IN (SELECT id FROM audit_event ORDER BY occurred_at DESC, id OFFSET $1)`);
    await run("historical_response", `DELETE FROM historical_response WHERE id IN (SELECT id FROM historical_response ORDER BY imported_at DESC, id OFFSET $1)`);
    await run("session", `DELETE FROM session WHERE expires_at < now() OR id IN (SELECT id FROM session ORDER BY updated_at DESC, id OFFSET $1)`);
    await run("background_job", `DELETE FROM pgboss.job WHERE state IN ('completed', 'failed', 'cancelled') AND id IN (SELECT id FROM pgboss.job WHERE state IN ('completed', 'failed', 'cancelled') ORDER BY created_on DESC OFFSET $1)`);
    // Queue items whose record is gone.
    await run("operator_item", `DELETE FROM operator_item o WHERE $1 > 0 AND (
        (o.subject_type = 'survey_response' AND NOT EXISTS (SELECT 1 FROM survey_response r WHERE r.id::text = o.subject_id))
        OR (o.subject_type = 'invitation' AND NOT EXISTS (SELECT 1 FROM invitation i WHERE i.id::text = o.subject_id))
        OR (o.subject_type = 'email_intent' AND NOT EXISTS (SELECT 1 FROM email_intent e WHERE e.id::text = o.subject_id)))`);

    for (const table of GUARDED) await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return removed;
}
