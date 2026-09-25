/**
 * Background worker process. Runs next to the web app from the same codebase
 * and image (PDF: "a scheduled worker drains durable database jobs; it is safe
 * to run concurrently and after process restarts").
 *
 *   npm run worker
 *
 * Email dispatch, reminders and reconciliation jobs register here as they ship.
 */
import { PgBoss } from "pg-boss";
import { logger } from "@/lib/logger";

const QUEUES = {
  heartbeat: "system.heartbeat",
} as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const boss = new PgBoss(connectionString);
  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
  await boss.start();

  await boss.createQueue(QUEUES.heartbeat);
  await boss.schedule(QUEUES.heartbeat, "* * * * *");
  await boss.work(QUEUES.heartbeat, async () => {
    logger.debug("worker heartbeat");
  });

  logger.info({ queues: Object.values(QUEUES) }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker stopping");
    // Let in-flight jobs finish; unfinished jobs are retried by another worker.
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
