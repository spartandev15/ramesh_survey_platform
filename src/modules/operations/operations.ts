import "server-only";
import { getDb } from "@/db/client";
import { toCsv } from "@/lib/csv";
import { requireCapability } from "@/modules/access/principal";
import { recordAudit } from "@/modules/audit/audit";
import { filterItems, QUEUE_LABELS, searchItems, sortItemsBy, type OwnerFilter, type QueueKind, type QueueSearch } from "./policy";
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

/**
 * The queue as CSV with the page's filters, every page not just one. Titles
 * can name customers, so each export is audited like the results export (SR-40).
 */
export async function exportOperatorQueue(filters: { kind: QueueKind | null; owner: OwnerFilter; includeTest: boolean; search: QueueSearch }) {
  const { principal } = await requireCapability("operations.view");
  return getDb().transaction(async (tx) => {
    const all = await store.listOperatorItems(tx, new Date(), { history: false, includeTest: filters.includeTest });
    const items = sortItemsBy(searchItems(filterItems(all, { owner: filters.owner, userId: principal.userId, includeTest: filters.includeTest }), filters.search), filters.search.sort).filter((i) => !filters.kind || i.kind === filters.kind);
    await recordAudit(
      { actorType: "user", actorUserId: principal.userId, action: "operator_queue.exported", subjectType: "operator_queue", subjectId: filters.kind ?? "all", after: { ...filters, rows: items.length } },
      tx,
    );
    const rows = items.map((i) => [QUEUE_LABELS[i.kind], i.title, i.shopName ?? "", i.reason, i.provenance ?? "", i.since.toISOString(), i.overdue ? "yes" : "no", i.owner?.name ?? "", i.isTest ? "yes" : "no"]);
    return toCsv(["Queue", "Item", "Shop", "Why", "Origin", "Waiting since", "Overdue", "Owner", "Test data"], rows);
  });
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

/** Mark a failed job or an import row reviewed, with what was done. */
export async function reviewOperatorItem(subjectType: string, subjectId: string, expectedRevision: number, note: string) {
  const { principal } = await requireCapability("operations.manage");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new store.OperationsError("invalid", "Reload the page and try again.");
  return getDb().transaction((tx) => store.reviewItem(tx, { type: "user", userId: principal.userId }, subjectType, subjectId.slice(0, 64), expectedRevision, note.slice(0, 2000)));
}
