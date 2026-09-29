import { sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { logger } from "@/lib/logger";
import type { EmailTransport } from "@/modules/email";
import { dailyReportEmail, findProblems, noticeAction, noticeEmail, PROBLEM_KEYS, REPORT_TIMEZONE, reportKey, type HealthFacts } from "./policy";
import * as store from "./store";

/**
 * Worker jobs that tell PSG operations when something needs them (PDF 09).
 * Without OPS_ALERT_EMAILS the notices are written to the log instead.
 */

export interface Notify {
  transport: EmailTransport;
  recipients: string[];
  appUrl: string;
}

export function opsRecipients(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

async function deliver(notify: Notify, email: { subject: string; text: string }) {
  if (notify.recipients.length === 0) {
    logger.warn({ subject: email.subject, text: email.text }, "operations notice (set OPS_ALERT_EMAILS to email it)");
    return;
  }
  for (const to of notify.recipients) await notify.transport.send({ to, subject: email.subject, text: email.text });
}

/**
 * Check queue health and email a notice when a problem starts, hourly while
 * it lasts, and once when it clears. A failed send is not recorded, so the
 * next check tries again.
 */
export async function runHealthCheck(notify: Notify, now = new Date()) {
  return getDb().transaction(async (tx) => {
    // One check at a time across workers, so a notice is never sent twice.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ops_health_check'))`);
    return notifyProblems(tx, await store.healthFacts(tx, now), notify, now);
  });
}

/** Compare the problems found now with what was last sent, and send what changed. */
export async function notifyProblems(tx: Tx, facts: HealthFacts, notify: Notify, now: Date) {
  const problems = new Map(findProblems(facts, now).map((p) => [p.key, p]));
  const sent: string[] = [];
  for (const key of PROBLEM_KEYS) {
    const problem = problems.get(key);
    const stored = await store.lockNotice(tx, key);
    const action = noticeAction(stored, Boolean(problem), now);
    if (action === "none") continue;
    const detail = problem?.summary ?? stored?.detail ?? "";
    await deliver(notify, noticeEmail(key, action, detail, notify.appUrl));
    await store.saveNotice(tx, key, { open: action !== "recover", detail, sent: true }, now);
    sent.push(`${key}:${action}`);
  }
  return sent;
}

/** Local hour in the report zone; the report goes out once a day from this hour on. */
const REPORT_HOUR = 7;

/**
 * The daily reconciliation. The job runs hourly; the first run after 07:00
 * in the report zone claims the day and sends. If sending fails, the claim
 * rolls back and the next hour tries again.
 */
export async function runDailyReport(notify: Notify, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: REPORT_TIMEZONE }).format(now));
  if (hour < REPORT_HOUR) return false;
  return getDb().transaction((tx) => sendDailyReport(tx, notify, now));
}

/** Claim the day, then send; false when this day's report already went out. */
export async function sendDailyReport(tx: Tx, notify: Notify, now: Date) {
  if (!(await store.claimReport(tx, reportKey(now), now))) return false;
  await deliver(notify, dailyReportEmail(await store.dailyCounts(tx, now), now, notify.appUrl));
  return true;
}
