/**
 * Backup and restore drill (SR-48, PDF 07 recovery evidence). Takes a full
 * backup of DATABASE_URL, restores it into a separate, empty drill database,
 * and checks the copy: row counts of the key tables match what existed at
 * backup time, and the data guards (append-only history, locked answers)
 * came back too. Prints how long backup and restore took, as evidence for
 * the recovery time objective. It never writes to DATABASE_URL.
 *
 * An administrator creates the drill database once, owned by the app user:
 *   createdb -U postgres -O psg psg_survey_drill
 * then:
 *   DRILL_DATABASE_URL=postgres://psg:...@localhost/psg_survey_drill npm run restore-drill
 *
 * PG_BIN points at the PostgreSQL client tools if they are not on PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

const TABLES = ["shop", "instrument_version", "invitation", "survey_response", "response_revision", "email_intent", "alert_case", "suppression_action", "audit_event", "legacy_case", "bridge_event"];

const source = process.env.DATABASE_URL;
const drill = process.env.DRILL_DATABASE_URL;
const bin = (tool: string) => (process.env.PG_BIN ? join(process.env.PG_BIN, tool) : tool);

async function counts(url: string) {
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const out: Record<string, number> = {};
    for (const t of TABLES) out[t] = Number((await db.query(`SELECT count(*)::bigint AS n FROM "${t}"`)).rows[0].n);
    return out;
  } finally {
    await db.end();
  }
}

/** A guard that must refuse the change in the restored copy too; true when it did. */
async function refuses(url: string, statement: string) {
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(statement);
    return false;
  } catch {
    return true;
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    await db.end();
  }
}

async function main() {
  if (!source) throw new Error("DATABASE_URL is required");
  if (!drill) {
    console.error("Set DRILL_DATABASE_URL to an empty drill database (see the top of scripts/restore-drill.ts).");
    process.exit(2);
  }
  if (new URL(drill).pathname === new URL(source).pathname && new URL(drill).host === new URL(source).host) throw new Error("The drill database must not be the live database.");

  const dir = mkdtempSync(join(tmpdir(), "psg-restore-drill-"));
  const file = join(dir, "backup.dump");
  try {
    // pg_dump reads one consistent snapshot; counts before and after bracket it.
    const before = await counts(source);
    let t = Date.now();
    execFileSync(bin("pg_dump"), ["--format=custom", "--no-owner", "--file", file, source], { stdio: "inherit" });
    const backupSeconds = (Date.now() - t) / 1000;
    const after = await counts(source);

    t = Date.now();
    execFileSync(bin("pg_restore"), ["--clean", "--if-exists", "--no-owner", "--dbname", drill, file], { stdio: "inherit" });
    const restoreSeconds = (Date.now() - t) / 1000;
    const restored = await counts(drill);

    const results: { check: string; ok: boolean; detail: string }[] = [];
    for (const table of TABLES) {
      const ok = restored[table] >= before[table] && restored[table] <= after[table];
      results.push({ check: `Rows in ${table}`, ok, detail: `${restored[table]} restored (live had ${before[table]} to ${after[table]} during the backup)` });
    }
    results.push({ check: "History stays append-only", ok: await refuses(drill, "UPDATE audit_event SET action = action WHERE id = (SELECT min(id) FROM audit_event)"), detail: "audit_event refuses changes" });
    results.push({
      check: "Submitted answers stay locked",
      ok: await refuses(drill, "UPDATE survey_response SET draft_answers = '{}' WHERE id = (SELECT id FROM survey_response WHERE status = 'submitted' LIMIT 1)"),
      detail: "survey_response refuses changing submitted answers",
    });

    console.log("");
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(32)} ${r.detail}`);
    console.log(`\nBackup ${backupSeconds.toFixed(1)} s (${(statSync(file).size / 1024 / 1024).toFixed(1)} MB), restore ${restoreSeconds.toFixed(1)} s.`);
    console.log("The recovery point depends on how often production backs up (or archives WAL); this drill proves a full backup restores intact.");
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
