/**
 * Background worker process. Runs next to the web app from the same codebase
 * and image (PDF: "a scheduled worker drains durable database jobs; it is safe
 * to run concurrently and after process restarts").
 *
 *   npm run worker
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { emailTransport } from "@/modules/email";
import { configuredAdapter } from "@/modules/bridge/adapter";
import { runBridgeCycle } from "@/modules/bridge/sync";
import { runDispatchCycle, runReminderScheduler } from "@/modules/email-ledger/dispatcher";
import { pruneDevData, pruneKeep } from "@/modules/devtools/prune";
import { opsRecipients, runCleanup, runDailyReport, runHealthCheck, type Notify } from "@/modules/monitoring/monitoring";

const QUEUES = {
  heartbeat: "system.heartbeat",
  // Sends due survey emails; the ledger, not the queue, guarantees one send per intent.
  emailDispatch: "email.dispatch",
  // Creates the single reminder per invitation once its delay has passed (SR-24).
  emailReminders: "email.reminders",
  // Outbound copy of required Hub records to FileMaker; does nothing until it is set up and switched on (SR-41).
  bridgeSync: "bridge.sync",
  // Emails PSG operations when sending is stuck or failing (PDF 09: within 15 minutes).
  opsHealth: "ops.health",
  // Daily reconciliation counts for PSG operations (PDF 09); sends once a day.
  opsDaily: "ops.daily",
  // Development only (DEV_PRUNE_KEEP): holds the local database to its newest rows.
  devPrune: "dev.prune",
} as const;

// Identifies this process on claimed intents, so a lease can only be settled by its owner.
const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  // The queue keeps its own connections next to the app pool; a pooled database with a small client limit
  // (Supabase's session pooler allows 15) needs it small (QUEUE_POOL_MAX).
  const boss = new PgBoss({ connectionString, max: Number(process.env.QUEUE_POOL_MAX) || 10 });
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
  await boss.start();

  for (const queue of Object.values(QUEUES)) await boss.createQueue(queue);
  // The heartbeat runs every minute and only its latest run matters: keep a day of it, not the default week.
  await boss.updateQueue(QUEUES.heartbeat, { deleteAfterSeconds: 24 * 60 * 60 });
  await boss.schedule(QUEUES.heartbeat, "* * * * *");
  await boss.schedule(QUEUES.emailDispatch, "* * * * *");
  await boss.schedule(QUEUES.emailReminders, "*/5 * * * *");
  await boss.schedule(QUEUES.opsHealth, "*/5 * * * *");
  await boss.schedule(QUEUES.opsDaily, "5 * * * *");
  // No FileMaker connection yet (G-09): no bridge job at all, rather than an empty one every minute.
  if (configuredAdapter()) await boss.schedule(QUEUES.bridgeSync, "* * * * *");
  else await boss.unschedule(QUEUES.bridgeSync);
  const pruneTo = process.env.NODE_ENV === "production" ? null : pruneKeep(process.env.DEV_PRUNE_KEEP);
  if (pruneTo) await boss.schedule(QUEUES.devPrune, "*/15 * * * *");
  else await boss.unschedule(QUEUES.devPrune);

  await boss.work(QUEUES.heartbeat, async () => {
    logger.debug("worker heartbeat");
  });
  await boss.work(QUEUES.emailDispatch, async () => {
    const summary = await runDispatchCycle(emailTransport(), WORKER_ID);
    if (Object.values(summary).some((n) => n > 0)) logger.info({ summary }, "email dispatch cycle");
  });
  await boss.work(QUEUES.emailReminders, async () => {
    const created = await runReminderScheduler();
    if (created > 0) logger.info({ created }, "reminders scheduled");
  });
  await boss.work(QUEUES.bridgeSync, async () => {
    const summary = await runBridgeCycle(configuredAdapter(), WORKER_ID);
    if (summary.queued > 0 || summary.confirmed > 0 || summary.errors > 0 || summary.conflicts > 0) logger.info({ summary }, "bridge cycle");
  });

  const notify: Notify = { transport: emailTransport(), recipients: opsRecipients(env().OPS_ALERT_EMAILS), appUrl: env().APP_URL.replace(/\/$/, "") };
  if (notify.recipients.length === 0) logger.warn("OPS_ALERT_EMAILS is not set: operations notices go to the log only");
  await boss.work(QUEUES.opsHealth, async () => {
    const sent = await runHealthCheck(notify);
    if (sent.length > 0) logger.info({ sent }, "operations notices");
  });
  await boss.work(QUEUES.opsDaily, async () => {
    if (await runDailyReport(notify)) logger.info("daily counts report sent");
    const removed = await runCleanup();
    if (Object.values(removed).some((n) => n > 0)) logger.info({ removed }, "expired rows removed");
  });

  await boss.work(QUEUES.devPrune, async () => {
    if (!pruneTo) return;
    const removed = await pruneDevData(pruneTo);
    if (Object.keys(removed).length > 0) logger.info({ removed, keep: pruneTo }, "development data pruned");
  });

  logger.info({ queues: Object.values(QUEUES), workerId: WORKER_ID }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker stopping");
    // Let in-flight jobs finish; an interrupted send becomes acceptance-unknown, never a blind resend.
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
