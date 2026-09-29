import "server-only";
import { getDb, type Tx } from "@/db/client";
import { logger } from "@/lib/logger";
import type { BridgeAdapter } from "./adapter";
import { editedInFileMaker, payloadHash, readiness, recordKey, type EntityType } from "./policy";
import * as store from "./store";

type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * One bridge pass (SR-41, SR-43): nothing happens unless a FileMaker
 * connection exists and every PSG check is recorded. Then queue new Hub
 * versions and write due events one at a time, each confirmed only when a
 * read-back matches. No database transaction stays open during a FileMaker
 * call. A FileMaker outage leaves events waiting and never blocks Hub (SR-35).
 *
 * `run` executes each step in its own transaction; tests pass one that reuses theirs.
 */
export async function runBridgeCycle(adapter: BridgeAdapter | null, owner: string, options: { now?: () => Date; limit?: number; scope?: { entityIds: string[] }; run?: Run } = {}) {
  const now = options.now ?? (() => new Date());
  const run: Run = options.run ?? ((fn) => getDb().transaction(fn));
  const summary = { enabled: false, queued: 0, confirmed: 0, conflicts: 0, errors: 0 };
  if (!adapter) return summary;
  const state = readiness(true, await run((tx) => store.confirmedGates(tx)));
  if (!state.enabled) return summary;
  summary.enabled = true;

  summary.queued = await run((tx) => store.project(tx, now(), options.scope));
  for (let i = 0; i < (options.limit ?? 100); i++) {
    const claimed = await run((tx) => store.claimNext(tx, owner, now(), options.scope));
    if (!claimed) break;
    const outcome = await write(adapter, claimed.event, claimed.mapping);
    await run((tx) => store.recordOutcome(tx, claimed.event.id, owner, outcome, now()));
    summary[outcome.result === "confirmed" ? "confirmed" : outcome.result === "conflict" ? "conflicts" : "errors"]++;
    // Ids and outcomes only: never payloads, which hold customer answers.
    logger.info({ bridgeEventId: claimed.event.id, outcome: outcome.result }, "bridge write");
  }
  return summary;
}

async function write(adapter: BridgeAdapter, event: store.EventRow, mapping: store.MappingRow | null): Promise<store.WriteOutcome> {
  try {
    // Someone changed the record in FileMaker since Hub last confirmed it: quarantine, never overwrite silently.
    if (mapping && !event.overwriteApprovedBy) {
      const current = await adapter.read(mapping.externalId);
      if (editedInFileMaker(current, mapping.confirmedHash)) return { result: "conflict", detail: "The FileMaker record was changed outside Hub since Hub last confirmed it." };
    }
    const { externalId } = await adapter.upsert(recordKey(event.entityType as EntityType, event.entityId), event.payload as Record<string, unknown>);
    const readBack = await adapter.read(externalId);
    // An acknowledgement alone is not proof (PDF 04): only a matching read-back confirms.
    if (!readBack || payloadHash(readBack) !== event.payloadHash) return { result: "error", error: "FileMaker accepted the write but the read-back did not match." };
    return { result: "confirmed", externalId };
  } catch (error) {
    return { result: "error", error: error instanceof Error ? error.message : "FileMaker call failed" };
  }
}
