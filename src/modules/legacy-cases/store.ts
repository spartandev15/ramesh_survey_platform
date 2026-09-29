import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { historicalResponse, legacyCase, legacyCaseNote, shop, user } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { RESOLUTION_OUTCOMES, type ResolutionOutcome } from "@/modules/cases/store";

/**
 * Legacy unresolved cases (SR-46). Imported through the import pipeline;
 * here PSG takes an open case over into Hub follow-up by an explicit handoff,
 * adds notes and confirms the resolution. Closed legacy cases stay reference
 * only. Runs inside the caller's transaction and does NOT authorize.
 */

export type Actor = { type: "user"; userId: string };

export class LegacyCaseError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "LegacyCaseError";
  }
}

export const LEGACY_VIEWS = ["with_legacy", "in_hub", "resolved", "reference"] as const;
export type LegacyView = (typeof LEGACY_VIEWS)[number];

export const LEGACY_VIEW_LABELS: Record<LegacyView, string> = {
  with_legacy: "Still with legacy owner",
  in_hub: "Followed up in Hub",
  resolved: "Resolved in Hub",
  reference: "Closed in legacy (reference only)",
};

function viewWhere(view: LegacyView) {
  switch (view) {
    case "with_legacy":
      return and(eq(legacyCase.legacyStatus, "open"), isNull(legacyCase.handedOffAt));
    case "in_hub":
      return and(isNotNull(legacyCase.handedOffAt), isNull(legacyCase.resolvedAt));
    case "resolved":
      return isNotNull(legacyCase.resolvedAt);
    case "reference":
      return and(eq(legacyCase.legacyStatus, "closed"), isNull(legacyCase.handedOffAt));
  }
}

export async function listLegacyCases(tx: Tx, view: LegacyView, offset: number, size: number) {
  return tx
    .select({ c: legacyCase, shopName: shop.name })
    .from(legacyCase)
    .innerJoin(shop, eq(shop.id, legacyCase.shopId))
    .where(viewWhere(view))
    .orderBy(asc(legacyCase.openedOn), asc(legacyCase.createdAt), asc(legacyCase.id))
    .limit(size)
    .offset(offset);
}

/** How many cases are in each state, to reconcile against the legacy system's own count (PDF 09). */
export async function legacyCaseCounts(tx: Tx): Promise<Record<LegacyView, number>> {
  const [row] = await tx
    .select({
      with_legacy: sql<number>`count(*) FILTER (WHERE ${legacyCase.legacyStatus} = 'open' AND ${legacyCase.handedOffAt} IS NULL)::int`,
      in_hub: sql<number>`count(*) FILTER (WHERE ${legacyCase.handedOffAt} IS NOT NULL AND ${legacyCase.resolvedAt} IS NULL)::int`,
      resolved: sql<number>`count(*) FILTER (WHERE ${legacyCase.resolvedAt} IS NOT NULL)::int`,
      reference: sql<number>`count(*) FILTER (WHERE ${legacyCase.legacyStatus} = 'closed' AND ${legacyCase.handedOffAt} IS NULL)::int`,
    })
    .from(legacyCase);
  return row;
}

export async function getLegacyCase(tx: Tx, caseId: string) {
  const [row] = await tx.select({ c: legacyCase, shopName: shop.name }).from(legacyCase).innerJoin(shop, eq(shop.id, legacyCase.shopId)).where(eq(legacyCase.id, caseId));
  if (!row) return null;
  const names = async (id: string | null) => (id ? ((await tx.select({ name: user.name }).from(user).where(eq(user.id, id)))[0]?.name ?? null) : null);
  const notes = await tx
    .select({ id: legacyCaseNote.id, body: legacyCaseNote.body, createdAt: legacyCaseNote.createdAt, author: user.name })
    .from(legacyCaseNote)
    .leftJoin(user, eq(user.id, legacyCaseNote.authorUserId))
    .where(eq(legacyCaseNote.caseId, caseId))
    .orderBy(asc(legacyCaseNote.id));
  // The historical answers stay read-only; they are only shown here (AT-46).
  const [historical] = row.c.responseRef
    ? await tx
        .select({ respondedOn: historicalResponse.respondedOn, measures: historicalResponse.measures, sourceSystem: historicalResponse.sourceSystem })
        .from(historicalResponse)
        .where(and(eq(historicalResponse.shopId, row.c.shopId), eq(historicalResponse.sourceRef, row.c.responseRef)))
        .orderBy(desc(historicalResponse.respondedOn))
        .limit(1)
    : [];
  return { ...row, notes, historical: historical ?? null, handedOffByName: await names(row.c.handedOffBy), resolvedByName: await names(row.c.resolvedBy) };
}

async function lock(tx: Tx, caseId: string, expectedRevision: number) {
  const [c] = await tx.select().from(legacyCase).where(eq(legacyCase.id, caseId)).for("update");
  if (!c) throw new LegacyCaseError("not_found", "This case no longer exists.");
  if (c.revision !== expectedRevision) throw new LegacyCaseError("conflict", "This case changed since you opened it. Reload the page.");
  return c;
}

/**
 * Hub takes over an open legacy case (SR-46). PSG confirms the legacy owner
 * has stopped following it up, so the customer is not contacted by both.
 */
export async function handOff(tx: Tx, actor: Actor, caseId: string, expectedRevision: number, note: string, now = new Date()) {
  const c = await lock(tx, caseId, expectedRevision);
  if (c.handedOffAt) throw new LegacyCaseError("conflict", "This case is already followed up in Hub.");
  if (c.legacyStatus !== "open") throw new LegacyCaseError("invalid", "This case was closed in the legacy system, so it stays reference only.");
  const trimmed = note.trim();
  if (trimmed.length < 10) throw new LegacyCaseError("invalid", "Record who you agreed the handoff with, so both systems never follow up the same customer.");
  await tx
    .update(legacyCase)
    .set({ handedOffAt: now, handedOffBy: actor.userId, handoffNote: trimmed.slice(0, 2000), revision: c.revision + 1, updatedAt: now })
    .where(eq(legacyCase.id, caseId));
  await recordAudit({ actorType: "user", actorUserId: actor.userId, shopId: c.shopId, action: "legacy_case.handed_off", subjectType: "legacy_case", subjectId: caseId, after: { sourceRef: c.sourceRef, legacyOwner: c.legacyOwner, note: trimmed } }, tx);
}

export async function addNote(tx: Tx, actor: Actor, caseId: string, body: string, now = new Date()) {
  const [c] = await tx.select({ handedOffAt: legacyCase.handedOffAt, shopId: legacyCase.shopId }).from(legacyCase).where(eq(legacyCase.id, caseId));
  if (!c) throw new LegacyCaseError("not_found", "This case no longer exists.");
  if (!c.handedOffAt) throw new LegacyCaseError("invalid", "Take the case over into Hub before adding follow-up notes.");
  const trimmed = body.trim();
  if (trimmed.length < 2) throw new LegacyCaseError("invalid", "Write the note first.");
  await tx.insert(legacyCaseNote).values({ caseId, authorUserId: actor.userId, body: trimmed.slice(0, 5000), createdAt: now });
  await recordAudit({ actorType: "user", actorUserId: actor.userId, shopId: c.shopId, action: "legacy_case.note_added", subjectType: "legacy_case", subjectId: caseId }, tx);
}

/** Only PSG confirms the final resolution, with a recorded outcome (SR-34, SR-46). */
export async function resolve(tx: Tx, actor: Actor, caseId: string, expectedRevision: number, outcome: string, note: string, now = new Date()) {
  const c = await lock(tx, caseId, expectedRevision);
  if (!c.handedOffAt) throw new LegacyCaseError("invalid", "Take the case over into Hub first.");
  if (c.resolvedAt) throw new LegacyCaseError("conflict", "This case is already resolved.");
  if (!(outcome in RESOLUTION_OUTCOMES)) throw new LegacyCaseError("invalid", "Choose the outcome.");
  const trimmed = note.trim();
  if (trimmed.length < 5) throw new LegacyCaseError("invalid", "Record how it was resolved.");
  await tx.insert(legacyCaseNote).values({ caseId, authorUserId: actor.userId, body: `Resolved: ${trimmed.slice(0, 5000)}`, createdAt: now });
  await tx
    .update(legacyCase)
    .set({ resolvedAt: now, resolvedBy: actor.userId, resolutionOutcome: outcome as ResolutionOutcome, revision: c.revision + 1, updatedAt: now })
    .where(eq(legacyCase.id, caseId));
  await recordAudit({ actorType: "user", actorUserId: actor.userId, shopId: c.shopId, action: "legacy_case.resolved", subjectType: "legacy_case", subjectId: caseId, after: { outcome } }, tx);
}
