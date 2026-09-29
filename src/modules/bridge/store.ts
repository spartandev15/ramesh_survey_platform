import "server-only";
import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { bridgeEvent, bridgeGate, bridgeMapping, shop, user } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { afterError, GATE_LABELS, GATES, isGate, payloadHash, SOURCE_MARKER, type EntityType, type EventState, type Gate } from "./policy";

/**
 * FileMaker bridge persistence (SR-41..SR-43). Runs inside the caller's
 * transaction and does NOT authorize. Hub is the source: events are built
 * from Hub records and nothing here writes Hub data from FileMaker.
 */

export type Actor = { type: "user"; userId: string };

export class BridgeError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

const LEASE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Gates (SR-42, G-09)
// ---------------------------------------------------------------------------

export async function confirmedGates(tx: Tx): Promise<Set<Gate>> {
  const rows = await tx.select({ item: bridgeGate.item }).from(bridgeGate);
  return new Set(rows.map((r) => r.item).filter(isGate));
}

export async function listGates(tx: Tx) {
  return tx.select({ item: bridgeGate.item, confirmedAt: bridgeGate.confirmedAt, note: bridgeGate.note, by: user.name }).from(bridgeGate).innerJoin(user, eq(user.id, bridgeGate.confirmedBy));
}

/** Record one check. Writes can be switched on only after every other check. */
export async function confirmGate(tx: Tx, actor: Actor, item: string, note: string, now = new Date()) {
  if (!isGate(item)) throw new BridgeError("invalid", "Choose a check to record.");
  const trimmed = note.trim();
  if (trimmed.length < 5) throw new BridgeError("invalid", "Write what was checked, and by whom.");
  if (item === "writes_enabled") {
    const have = await confirmedGates(tx);
    const missing = GATES.filter((g) => g !== "writes_enabled" && !have.has(g));
    if (missing.length > 0) throw new BridgeError("invalid", `Record these first: ${missing.map((g) => GATE_LABELS[g].label).join(", ")}.`);
  }
  const [created] = await tx.insert(bridgeGate).values({ item, confirmedBy: actor.userId, confirmedAt: now, note: trimmed.slice(0, 2000) }).onConflictDoNothing().returning();
  if (!created) throw new BridgeError("conflict", "This check is already recorded. Reload the page.");
  await recordAudit({ actorType: "user", actorUserId: actor.userId, action: "bridge.gate_confirmed", subjectType: "bridge_gate", subjectId: item, after: { note: created.note } }, tx);
}

/** Withdraw one check. Withdrawing any other check also switches writes off. */
export async function withdrawGate(tx: Tx, actor: Actor, item: string) {
  if (!isGate(item)) throw new BridgeError("invalid", "Choose a check to withdraw.");
  const items: Gate[] = item === "writes_enabled" ? ["writes_enabled"] : [item, "writes_enabled"];
  const removed = await tx.delete(bridgeGate).where(inArray(bridgeGate.item, items)).returning({ item: bridgeGate.item });
  if (!removed.some((r) => r.item === item)) throw new BridgeError("conflict", "This check was already withdrawn. Reload the page.");
  for (const r of removed) await recordAudit({ actorType: "user", actorUserId: actor.userId, action: "bridge.gate_withdrawn", subjectType: "bridge_gate", subjectId: r.item }, tx);
}

// ---------------------------------------------------------------------------
// Projection: Hub records into the outbox
// ---------------------------------------------------------------------------

interface Projected {
  entityType: EntityType;
  entityId: string;
  entityVersion: number;
  shopId: string | null;
  payload: Record<string, unknown>;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/**
 * Queue every Hub record version FileMaker has not been given yet, and retire
 * older unsent versions of the same record (PDF 04: order per entity; older
 * revisions are no-ops). Test data never leaves Hub (SR-03). Idempotent:
 * running it again queues nothing new.
 */
export async function project(tx: Tx, now: Date, scope?: { entityIds: string[] }, limit = 500): Promise<number> {
  // Drizzle spreads an array into separate parameters, so the scope is an explicit IN list.
  const only = (col: string) =>
    scope
      ? sql`AND ${sql.raw(col)} IN (${sql.join(
          scope.entityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
  const responses = await tx.execute<{
    id: string;
    shop_id: string;
    source: string;
    submitted_at: Date;
    canonical: boolean;
    match_status: string;
    version: number;
    revision: number;
    visit_system: string | null;
    visit_key: string | null;
    answers: unknown;
    outcomes: { metrics?: Record<string, number | null>; alerts?: { id: string }[] };
  }>(sql`
    SELECT r.id, r.shop_id, r.source, r.submitted_at, r.canonical, r.match_status, rev.revision,
           rev.revision * 1000 + r.match_revision AS version, v.source_system AS visit_system, v.source_visit_key AS visit_key,
           rev.answers, rev.outcomes
    FROM survey_response r
    LEFT JOIN repair_visit v ON v.id = r.visit_id
    JOIN LATERAL (SELECT revision, answers, outcomes FROM response_revision WHERE response_id = r.id ORDER BY revision DESC LIMIT 1) rev ON true
    WHERE r.status = 'submitted' AND NOT r.is_test AND r.shop_id IS NOT NULL ${only("r.id")}
      AND NOT EXISTS (SELECT 1 FROM bridge_event e WHERE e.entity_type = 'response' AND e.entity_id = r.id AND e.entity_version = rev.revision * 1000 + r.match_revision)
    LIMIT ${limit}`);
  const cases = await tx.execute<{ id: string; shop_id: string; response_id: string; revision: number; status: string; follow_up: string; resolution_outcome: string | null; resolved_at: Date | null }>(sql`
    SELECT c.id, c.shop_id, c.response_id, c.revision, c.status, c.follow_up, c.resolution_outcome, c.resolved_at
    FROM alert_case c
    WHERE NOT c.is_test AND c.shop_id IS NOT NULL ${only("c.id")}
      AND NOT EXISTS (SELECT 1 FROM bridge_event e WHERE e.entity_type = 'case' AND e.entity_id = c.id AND e.entity_version = c.revision)
    LIMIT ${limit}`);
  const suppressions = await tx.execute<{ id: string; shop_id: string | null; response_id: string; revision: number; rule_id: string; desired: string; status: string; result: string | null; acknowledged_at: Date | null; visit_system: string | null; visit_key: string | null }>(sql`
    SELECT a.id, r.shop_id, a.response_id, a.revision, a.rule_id, a.desired, a.status, a.result, a.acknowledged_at, v.source_system AS visit_system, v.source_visit_key AS visit_key
    FROM suppression_action a
    JOIN survey_response r ON r.id = a.response_id
    LEFT JOIN repair_visit v ON v.id = r.visit_id
    WHERE NOT a.is_test AND r.shop_id IS NOT NULL ${only("a.id")}
      AND NOT EXISTS (SELECT 1 FROM bridge_event e WHERE e.entity_type = 'suppression' AND e.entity_id = a.id AND e.entity_version = a.revision)
    LIMIT ${limit}`);

  const visit = (system: string | null, key: string | null) => (key ? { system, key } : null);
  const items: Projected[] = [
    ...responses.rows.map((r) => ({
      entityType: "response" as const,
      entityId: r.id,
      entityVersion: Number(r.version),
      shopId: r.shop_id,
      payload: {
        source_marker: SOURCE_MARKER,
        hub_id: r.id,
        shop_id: r.shop_id,
        visit: visit(r.visit_system, r.visit_key),
        source: r.source,
        submitted_at: iso(r.submitted_at),
        revision: r.revision,
        counted: r.canonical,
        match_status: r.match_status,
        answers: r.answers,
        metrics: r.outcomes.metrics ?? {},
        alerts: (r.outcomes.alerts ?? []).map((a) => a.id),
      },
    })),
    ...cases.rows.map((c) => ({
      entityType: "case" as const,
      entityId: c.id,
      entityVersion: c.revision,
      shopId: c.shop_id,
      payload: { source_marker: SOURCE_MARKER, hub_id: c.id, response_hub_id: c.response_id, shop_id: c.shop_id, review: c.status, follow_up: c.follow_up, resolution: c.resolution_outcome, resolved_at: iso(c.resolved_at) },
    })),
    ...suppressions.rows.map((a) => ({
      entityType: "suppression" as const,
      entityId: a.id,
      entityVersion: a.revision,
      shopId: a.shop_id,
      payload: {
        source_marker: SOURCE_MARKER,
        hub_id: a.id,
        response_hub_id: a.response_id,
        shop_id: a.shop_id,
        visit: visit(a.visit_system, a.visit_key),
        rule: a.rule_id,
        desired: a.desired,
        status: a.status,
        result: a.result,
        acknowledged_at: iso(a.acknowledged_at),
      },
    })),
  ];

  let queued = 0;
  for (const item of items) {
    const [created] = await tx
      .insert(bridgeEvent)
      .values({ ...item, payloadHash: payloadHash(item.payload), createdAt: now, updatedAt: now, nextAttemptAt: now })
      .onConflictDoNothing()
      .returning({ id: bridgeEvent.id });
    if (!created) continue;
    queued++;
    await tx
      .update(bridgeEvent)
      .set({ state: "superseded", leaseOwner: null, leaseUntil: null, updatedAt: now })
      .where(
        and(
          eq(bridgeEvent.entityType, item.entityType),
          eq(bridgeEvent.entityId, item.entityId),
          lt(bridgeEvent.entityVersion, item.entityVersion),
          inArray(bridgeEvent.state, ["pending", "retrying", "failed", "conflict"]),
        ),
      );
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type EventRow = typeof bridgeEvent.$inferSelect;
export type MappingRow = typeof bridgeMapping.$inferSelect;

/** Claim the oldest due event (SKIP LOCKED, so workers never share one). A version FileMaker already has newer is skipped. */
export async function claimNext(tx: Tx, owner: string, now: Date, scope?: { entityIds: string[] }): Promise<{ event: EventRow; mapping: MappingRow | null } | null> {
  for (;;) {
    const [event] = await tx
      .select()
      .from(bridgeEvent)
      .where(
        and(
          inArray(bridgeEvent.state, ["pending", "retrying"]),
          sql`${bridgeEvent.nextAttemptAt} <= ${now}`,
          sql`(${bridgeEvent.leaseUntil} IS NULL OR ${bridgeEvent.leaseUntil} < ${now})`,
          scope ? inArray(bridgeEvent.entityId, scope.entityIds) : undefined,
        ),
      )
      .orderBy(asc(bridgeEvent.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!event) return null;
    const [mapping] = await tx
      .select()
      .from(bridgeMapping)
      .where(and(eq(bridgeMapping.entityType, event.entityType), eq(bridgeMapping.entityId, event.entityId)));
    if (mapping && mapping.confirmedVersion >= event.entityVersion) {
      await tx.update(bridgeEvent).set({ state: "superseded", updatedAt: now }).where(eq(bridgeEvent.id, event.id));
      continue;
    }
    await tx
      .update(bridgeEvent)
      .set({ leaseOwner: owner, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: event.attempts + 1, updatedAt: now })
      .where(eq(bridgeEvent.id, event.id));
    return { event: { ...event, attempts: event.attempts + 1 }, mapping: mapping ?? null };
  }
}

export type WriteOutcome = { result: "confirmed"; externalId: string } | { result: "conflict"; detail: string } | { result: "error"; error: string };

/** Record what happened. Only the worker holding the lease may settle it. */
export async function recordOutcome(tx: Tx, eventId: string, owner: string, outcome: WriteOutcome, now: Date) {
  const [event] = await tx.select().from(bridgeEvent).where(eq(bridgeEvent.id, eventId)).for("update");
  if (!event || event.leaseOwner !== owner) return;
  const common = { leaseOwner: null, leaseUntil: null, updatedAt: now };
  if (outcome.result === "confirmed") {
    await tx.update(bridgeEvent).set({ ...common, state: "confirmed", confirmedAt: now, lastError: null }).where(eq(bridgeEvent.id, eventId));
    // One FileMaker record per Hub record; never move it back to an older version.
    await tx
      .insert(bridgeMapping)
      .values({ entityType: event.entityType, entityId: event.entityId, externalId: outcome.externalId, confirmedVersion: event.entityVersion, confirmedHash: event.payloadHash, confirmedAt: now })
      .onConflictDoUpdate({
        target: [bridgeMapping.entityType, bridgeMapping.entityId],
        set: { externalId: outcome.externalId, confirmedVersion: event.entityVersion, confirmedHash: event.payloadHash, confirmedAt: now },
        setWhere: sql`${bridgeMapping.confirmedVersion} < ${event.entityVersion}`,
      });
    return;
  }
  if (outcome.result === "conflict") {
    await tx.update(bridgeEvent).set({ ...common, state: "conflict", lastError: outcome.detail.slice(0, 500) }).where(eq(bridgeEvent.id, eventId));
    await recordAudit({ actorType: "system", shopId: event.shopId, action: "bridge.conflict", subjectType: "bridge_event", subjectId: eventId, after: { entityType: event.entityType, entityId: event.entityId, detail: outcome.detail } }, tx);
    return;
  }
  const next = afterError(event.attempts, now);
  await tx
    .update(bridgeEvent)
    .set({ ...common, state: next.state, lastError: outcome.error.slice(0, 500), nextAttemptAt: next.state === "retrying" ? next.nextAttemptAt : event.nextAttemptAt })
    .where(eq(bridgeEvent.id, eventId));
  if (next.state === "failed") {
    await recordAudit({ actorType: "system", shopId: event.shopId, action: "bridge.failed", subjectType: "bridge_event", subjectId: eventId, after: { error: outcome.error.slice(0, 500), attempts: event.attempts } }, tx);
  }
}

// ---------------------------------------------------------------------------
// PSG decisions and status
// ---------------------------------------------------------------------------

async function lockEvent(tx: Tx, eventId: string, state: EventState) {
  const [event] = await tx.select().from(bridgeEvent).where(eq(bridgeEvent.id, eventId)).for("update");
  if (!event) throw new BridgeError("not_found", "This item no longer exists.");
  if (event.state !== state) throw new BridgeError("conflict", "This item changed since you opened the page. Reload and try again.");
  return event;
}

/** Try a failed write again. It is the same idempotent write, so it cannot create a second record. */
export async function retryEvent(tx: Tx, actor: Actor, eventId: string, now = new Date()) {
  const event = await lockEvent(tx, eventId, "failed");
  await tx.update(bridgeEvent).set({ state: "retrying", attempts: 0, nextAttemptAt: now, updatedAt: now }).where(eq(bridgeEvent.id, eventId));
  await recordAudit({ actorType: "user", actorUserId: actor.userId, shopId: event.shopId, action: "bridge.retry", subjectType: "bridge_event", subjectId: eventId, after: { lastError: event.lastError } }, tx);
}

/**
 * After reviewing a change made in FileMaker, put Hub's version back there.
 * Hub never takes the FileMaker change: Hub owns this record (SR-43).
 */
export async function keepHubVersion(tx: Tx, actor: Actor, eventId: string, note: string, now = new Date()) {
  const event = await lockEvent(tx, eventId, "conflict");
  const trimmed = note.trim();
  if (trimmed.length < 5) throw new BridgeError("invalid", "Write what you checked with the FileMaker owner.");
  await tx.update(bridgeEvent).set({ state: "pending", overwriteApprovedBy: actor.userId, attempts: 0, nextAttemptAt: now, updatedAt: now }).where(eq(bridgeEvent.id, eventId));
  await recordAudit({ actorType: "user", actorUserId: actor.userId, shopId: event.shopId, action: "bridge.keep_hub_version", subjectType: "bridge_event", subjectId: eventId, after: { note: trimmed, change: event.lastError } }, tx);
}

export async function stateCounts(tx: Tx): Promise<Record<EventState, number>> {
  const rows = await tx.select({ state: bridgeEvent.state, n: count() }).from(bridgeEvent).groupBy(bridgeEvent.state);
  const counts = { pending: 0, retrying: 0, failed: 0, conflict: 0, confirmed: 0, superseded: 0 } as Record<EventState, number>;
  for (const r of rows) counts[r.state as EventState] = r.n;
  return counts;
}

export async function listProblems(tx: Tx, offset: number, size: number) {
  return tx
    .select({ event: bridgeEvent, shopName: shop.name })
    .from(bridgeEvent)
    .leftJoin(shop, eq(shop.id, bridgeEvent.shopId))
    .where(inArray(bridgeEvent.state, ["failed", "conflict", "retrying"]))
    .orderBy(desc(bridgeEvent.updatedAt), desc(bridgeEvent.id))
    .limit(size)
    .offset(offset);
}

/** The newest bridge state of one Hub record, for its own page; null when it was never queued. */
export async function latestState(tx: Tx, entityType: EntityType, entityId: string) {
  const [row] = await tx
    .select({ state: bridgeEvent.state, confirmedAt: bridgeEvent.confirmedAt })
    .from(bridgeEvent)
    .where(and(eq(bridgeEvent.entityType, entityType), eq(bridgeEvent.entityId, entityId)))
    .orderBy(desc(bridgeEvent.entityVersion))
    .limit(1);
  return row ? { state: row.state as EventState, confirmedAt: row.confirmedAt } : null;
}

/** When FileMaker last confirmed a write, and how old the oldest waiting event is: the lag PSG sees (PDF 04). */
export async function lag(tx: Tx) {
  const [row] = await tx
    .select({
      lastConfirmedAt: sql<Date | null>`max(${bridgeEvent.confirmedAt})`,
      oldestWaiting: sql<Date | null>`min(${bridgeEvent.createdAt}) FILTER (WHERE ${bridgeEvent.state} IN ('pending', 'retrying'))`,
    })
    .from(bridgeEvent);
  return { lastConfirmedAt: row.lastConfirmedAt ? new Date(row.lastConfirmedAt) : null, oldestWaiting: row.oldestWaiting ? new Date(row.oldestWaiting) : null };
}
