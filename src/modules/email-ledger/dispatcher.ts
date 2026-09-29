import "server-only";
import { createHmac } from "node:crypto";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { EmailAcceptanceUnknownError, EmailRejectedError, type EmailTransport } from "@/modules/email/transport";
import * as store from "./store";

/** Opt-out links are signed with a key derived from the app secret, never the secret itself. */
export function optOutSecret(): string {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update("survey-opt-out-key").digest("hex");
}

function linkConfig(): store.LinkConfig {
  return { appUrl: env().APP_URL, optOutSecret: optOutSecret() };
}

/**
 * One dispatch pass: settle expired leases, then send due intents one at a
 * time. Safe to run in several workers at once (SKIP LOCKED claims) and after
 * a crash (leases). No database transaction is open during a provider call.
 */
export async function runDispatchCycle(transport: EmailTransport, owner: string, options: { links?: store.LinkConfig; now?: () => Date; limit?: number; scope?: { intentIds: string[] } } = {}) {
  const now = options.now ?? (() => new Date());
  const links = options.links ?? linkConfig();
  const db = getDb();
  const summary = { reclaimed: 0, sent: 0, held: 0, cancelled: 0, rejected: 0, unknown: 0 };

  summary.reclaimed = await db.transaction((tx) => store.reclaimExpiredLeases(tx, now()));

  for (let i = 0; i < (options.limit ?? 50); i++) {
    const prepared = await db.transaction((tx) => store.prepareNext(tx, owner, links, now(), options.scope));
    if (prepared.kind === "none") break;
    if (prepared.kind === "stopped") {
      summary[prepared.state === "held" ? "held" : "cancelled"]++;
      continue;
    }

    let outcome: store.ProviderOutcome;
    try {
      const result = await transport.send(prepared.message);
      outcome = { result: "accepted", providerMessageId: result.providerMessageId };
    } catch (error) {
      if (error instanceof EmailRejectedError) outcome = { result: "rejected", error: error.message };
      else if (error instanceof EmailAcceptanceUnknownError) outcome = { result: "unknown", error: error.message };
      // Anything unexpected after the call started may have reached the provider.
      else outcome = { result: "unknown", error: error instanceof Error ? error.message : "Unexpected error" };
    }
    await db.transaction((tx) => store.recordOutcome(tx, prepared.intentId, prepared.tokenId, owner, outcome, now()));
    summary[outcome.result === "accepted" ? "sent" : outcome.result]++;
    // Log ids and outcomes only, never recipients or links.
    logger.info({ intentId: prepared.intentId, outcome: outcome.result }, "survey email dispatch");
  }
  return summary;
}

export async function runReminderScheduler(now = new Date()) {
  return getDb().transaction((tx) => store.scheduleReminders(tx, now));
}
