import "server-only";
import { getDb } from "@/db/client";
import { requireCapability } from "@/modules/access/principal";
import * as store from "./store";

/**
 * Authorized entry points for the operator queues (SR-38). Every PSG role can
 * see the queues and take ownership; reviewing a worker failure needs
 * operations.manage. Items are fixed on their own pages with their own checks.
 */

export async function listOperatorQueues(includeTest: boolean) {
  await requireCapability("operations.view");
  return getDb().transaction(async (tx) => ({ items: await store.listOperatorItems(tx, new Date(), { includeTest }), operators: await store.listOperators(tx) }));
}

/** Counts for the Overview: open operator items (SR-38) and system health (SR-48). Production data only. */
export async function operatorQueueSummary() {
  await requireCapability("operations.view");
  return getDb().transaction(async (tx) => {
    const items = await store.listOperatorItems(tx, new Date(), { history: false, includeTest: false });
    return { open: items.length, overdue: items.filter((i) => i.overdue).length, unowned: items.filter((i) => !i.owner).length, health: await store.healthSnapshot(tx) };
  });
}

export async function assignOperatorOwner(subjectType: string, subjectId: string, ownerUserId: string | null, expectedRevision: number) {
  const { principal } = await requireCapability("operations.view");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new store.OperationsError("invalid", "Reload the page and try again.");
  return getDb().transaction((tx) => store.assignOwner(tx, { type: "user", userId: principal.userId }, subjectType, subjectId.slice(0, 64), ownerUserId || null, expectedRevision));
}

export async function reviewWorkerFailure(jobId: string, expectedRevision: number, note: string) {
  const { principal } = await requireCapability("operations.manage");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new store.OperationsError("invalid", "Reload the page and try again.");
  return getDb().transaction((tx) => store.reviewWorkerFailure(tx, { type: "user", userId: principal.userId }, jobId.slice(0, 64), expectedRevision, note.slice(0, 2000)));
}
