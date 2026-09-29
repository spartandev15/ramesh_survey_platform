import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  alertApproval,
  alertCase,
  auditEvent,
  bridgeEvent,
  emailIntent,
  importBatch,
  importRow,
  invitation,
  operatorItem,
  psgStaffRole,
  shop,
  suppressionAction,
  surveyResponse,
  user,
} from "@/db/schema";
import { hasCapability, type PsgRole } from "@/modules/access/capabilities";
import { recordAudit } from "@/modules/audit/audit";
import { listSuppressions } from "@/modules/cases/store";
import { listProblems } from "@/modules/email-ledger/store";
import { STOP_LABELS } from "@/modules/email-ledger/policy";
import { REASON_LABELS } from "@/modules/imports/eligibility";
import { listUnsent, shopsWithUnsent } from "@/modules/invitations/store";
import { isSubjectType, isSuppressionOverdue, WORKER_FAILURE_DAYS, workerHealth, type QueueKind, type SubjectType } from "./policy";

/**
 * Operator queues (SR-38). Items stay in the tables that own them and are
 * fixed on their own pages; this gathers them with a reason, age, owner and
 * audit history. Runs inside the caller's transaction and does NOT authorize.
 */

export type Actor = { type: "user"; userId: string };

export class OperationsError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "OperationsError";
  }
}

export interface HistoryEntry {
  at: Date;
  action: string;
  actorName: string | null;
  actorType: string;
  detail: string | null;
}

export interface OperatorItem {
  key: string;
  kind: QueueKind;
  subjectType: SubjectType;
  subjectId: string;
  shopId: string | null;
  shopName: string | null;
  isTest: boolean;
  title: string;
  reason: string;
  /** Where the item came from and its original error, kept even after a retry (AT-38). */
  provenance: string | null;
  since: Date;
  overdue: boolean;
  /** The page where the item is fixed; null when it is handled on the queue page itself. */
  href: string | null;
  hrefLabel: string | null;
  owner: { userId: string; name: string } | null;
  /** Revision of the ownership record; 0 while nobody has been assigned yet. */
  revision: number;
  history: HistoryEntry[];
}

type Draft = Omit<OperatorItem, "key" | "owner" | "revision" | "history">;

/** A safety limit per kind, far above any real open workload; the page itself shows 25 at a time. */
const PER_KIND = 1000;

const MATCH_REASONS: Record<string, string> = {
  visit_unmatched: "Shop known, visit not matched: not counted in scores yet",
  shop_unconfirmed: "Shop not confirmed: only PSG can see it until confirmed",
  duplicate_review: "Another response already counts for this visit: decide which one counts",
};

const SOURCE_NAMES: Record<string, string> = { online: "Online", public: "Public link", paper: "Paper" };
const EMAIL_NAMES: Record<string, string> = { initial: "Invitation", reminder: "Reminder", renewal: "New link", alert: "Shop alert" };
const EMAIL_STATES: Record<string, string> = { held: "On hold", failed: "Failed", bounced: "Bounced", acceptance_unknown: "Outcome unknown" };

const emailReason = (code: string | null) => (code ? (REASON_LABELS[code as keyof typeof REASON_LABELS] ?? STOP_LABELS[code] ?? code) : null);

async function heldImports(tx: Tx, includeTest: boolean): Promise<Draft[]> {
  // Only visits with no invitation email yet can be held, so only those shops are checked.
  const shops = await shopsWithUnsent(tx, includeTest);
  const items: Draft[] = [];
  for (const s of shops) {
    const held = (await listUnsent(tx, s.id, includeTest)).filter((r) => r.view === "held");
    for (const r of held.slice(0, PER_KIND)) {
      items.push({
        kind: "held_import",
        subjectType: "invitation",
        subjectId: r.id,
        shopId: s.id,
        shopName: s.name,
        isTest: r.isTest,
        title: `Visit ${r.sourceVisitKey} · ${r.customerName}`,
        reason: r.blockers.map((b) => REASON_LABELS[b]).join("; "),
        provenance: null,
        since: r.createdAt,
        overdue: false,
        href: `/psg/invitations?shop=${s.id}&view=held`,
        hrefLabel: "Open in Invitations",
      });
    }
  }
  // The file and row each visit came from (SR-06 provenance).
  const ids = items.map((i) => i.subjectId);
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: invitation.id, fileName: importBatch.fileName, rowNumber: importRow.rowNumber, importedAt: importBatch.createdAt })
      .from(invitation)
      .innerJoin(importRow, eq(importRow.id, invitation.importRowId))
      .innerJoin(importBatch, eq(importBatch.id, importRow.batchId))
      .where(inArray(invitation.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const item of items) {
      const p = byId.get(item.subjectId);
      if (p) item.provenance = `Imported from ${p.fileName}, row ${p.rowNumber}`;
    }
  }
  return items;
}

async function emailItems(tx: Tx): Promise<Draft[]> {
  const problems = await listProblems(tx, 0, PER_KIND * 2);
  return problems.map((p) => {
    const why = emailReason(p.stateReason);
    const unknown = p.state === "acceptance_unknown";
    return {
      kind: unknown ? "email_unknown" : "delivery",
      subjectType: "email_intent",
      subjectId: p.id,
      shopId: p.shopId,
      shopName: p.shopName,
      isTest: p.isTest,
      title: `${EMAIL_NAMES[p.kind] ?? p.kind} email${p.sourceVisitKey ? ` · visit ${p.sourceVisitKey}` : ""}`,
      reason: `${EMAIL_STATES[p.state] ?? p.state}${why ? `: ${why}` : p.lastError && !unknown ? `: ${p.lastError}` : ""}`,
      provenance: [`${p.attempts} attempt${p.attempts === 1 ? "" : "s"}, ${p.events} provider event${p.events === 1 ? "" : "s"}`, p.lastError ? `Last error: ${p.lastError}` : null].filter(Boolean).join(". "),
      since: p.updatedAt,
      overdue: false,
      href: "/psg/email",
      hrefLabel: "Open in Email review",
    } satisfies Draft;
  });
}

async function pgBossPresent(tx: Tx): Promise<boolean> {
  const result = await tx.execute<{ present: boolean }>(sql`SELECT to_regclass('pgboss.job') IS NOT NULL AS present`);
  return Boolean(result.rows[0]?.present);
}

/** When the worker last finished its heartbeat job; null before pg-boss exists or before the first beat. */
export async function lastHeartbeat(tx: Tx): Promise<Date | null> {
  if (!(await pgBossPresent(tx))) return null;
  const beat = await tx.execute<{ at: Date | null }>(sql`SELECT max(completed_on) AS at FROM pgboss.job WHERE name = 'system.heartbeat' AND state = 'completed'`);
  return beat.rows[0]?.at ? new Date(beat.rows[0].at) : null;
}

async function workerItems(tx: Tx, now: Date): Promise<Draft[]> {
  const present = await pgBossPresent(tx);
  const items: Draft[] = [];
  const health = workerHealth(present ? await lastHeartbeat(tx) : null, now);
  if (!health.ok) {
    items.push({
      kind: "worker",
      subjectType: "worker",
      subjectId: "heartbeat",
      shopId: null,
      shopName: null,
      isTest: false,
      title: "Background worker",
      reason: health.reason,
      provenance: health.since ? `Last heartbeat ${health.since.toISOString()}` : "No heartbeat recorded",
      since: health.since ?? now,
      overdue: true,
      href: null,
      hrefLabel: null,
    });
  }
  if (!present) return items;

  const since = new Date(now.getTime() - WORKER_FAILURE_DAYS * 24 * 60 * 60 * 1000);
  const failed = await tx.execute<{ id: string; name: string; output: unknown; at: Date; retries: number }>(sql`
    SELECT j.id::text AS id, j.name, j.output, COALESCE(j.completed_on, j.started_on, j.created_on) AS at, j.retry_count AS retries
    FROM pgboss.job j
    WHERE j.state = 'failed'
      AND position('__pgboss' in j.name) <> 1
      AND COALESCE(j.completed_on, j.started_on, j.created_on) >= ${since}
      AND NOT EXISTS (SELECT 1 FROM operator_item o WHERE o.subject_type = 'worker_job' AND o.subject_id = j.id::text AND o.reviewed_at IS NOT NULL)
    ORDER BY at DESC
    LIMIT ${PER_KIND}`);
  for (const job of failed.rows) {
    items.push({
      kind: "worker",
      subjectType: "worker_job",
      subjectId: job.id,
      shopId: null,
      shopName: null,
      isTest: false,
      title: `Job ${job.name} failed`,
      reason: jobError(job.output),
      provenance: `Job ${job.id}, ${job.retries} automatic retr${job.retries === 1 ? "y" : "ies"}`,
      since: new Date(job.at),
      overdue: false,
      href: null,
      hrefLabel: null,
    });
  }
  return items;
}

/** The error message only: stack traces and payloads stay out of the page. */
function jobError(output: unknown): string {
  const message = output && typeof output === "object" && "message" in output ? String((output as { message: unknown }).message) : null;
  return (message ?? "The job failed without an error message").slice(0, 300);
}

async function pendingMatches(tx: Tx, includeTest: boolean): Promise<Draft[]> {
  const rows = await tx
    .select({
      id: surveyResponse.id,
      source: surveyResponse.source,
      submittedAt: surveyResponse.submittedAt,
      receivedOn: surveyResponse.receivedOn,
      isTest: surveyResponse.isTest,
      matchStatus: surveyResponse.matchStatus,
      shopId: surveyResponse.shopId,
      shopName: shop.name,
    })
    .from(surveyResponse)
    .leftJoin(shop, eq(shop.id, surveyResponse.shopId))
    .where(and(eq(surveyResponse.status, "submitted"), ne(surveyResponse.matchStatus, "matched"), includeTest ? undefined : eq(surveyResponse.isTest, false)))
    .orderBy(asc(surveyResponse.submittedAt))
    .limit(PER_KIND);
  return rows.map((r) => ({
    kind: "pending_match",
    subjectType: "survey_response",
    subjectId: r.id,
    shopId: r.shopId,
    shopName: r.shopName,
    isTest: r.isTest,
    title: `${SOURCE_NAMES[r.source] ?? r.source} response`,
    reason: MATCH_REASONS[r.matchStatus] ?? r.matchStatus,
    provenance: r.receivedOn ? `Paper form received ${r.receivedOn}` : null,
    since: r.submittedAt ?? new Date(0),
    overdue: false,
    href: `/psg/responses/${r.id}`,
    hrefLabel: "Open response",
  }));
}

async function suppressionItems(tx: Tx, now: Date): Promise<Draft[]> {
  const rows = await listSuppressions(tx, "outstanding");
  return rows.slice(0, PER_KIND).map((r) => ({
    kind: "suppression",
    subjectType: "suppression_action",
    subjectId: r.action.id,
    shopId: null,
    shopName: r.shopName,
    isTest: r.action.isTest,
    title: `${r.action.desired === "apply" ? "Start suppressing" : "Stop suppressing"} routine mail`,
    reason: r.visitKey ? r.action.ruleLabel : `${r.action.ruleLabel}. Match the response to its visit first, so the FileMaker record is known.`,
    provenance: `${r.visitKey ? `${r.sourceSystem}: ${r.visitKey}, ` : ""}from response revision ${r.action.sourceRevision}`,
    since: r.action.createdAt,
    overdue: isSuppressionOverdue(r.action.createdAt, now),
    href: "/psg/suppression",
    hrefLabel: "Open Suppression queue",
  }));
}

function describeAudit(after: unknown): string | null {
  if (!after || typeof after !== "object") return null;
  const a = after as Record<string, unknown>;
  const parts = [a.error, a.note, a.evidence, a.reason, a.ownerName ? `to ${String(a.ownerName)}` : null].filter((v): v is string => typeof v === "string" && v.length > 0);
  return parts.length > 0 ? parts.join(" · ").slice(0, 300) : null;
}

/** Everything that needs an operator now, with owner and the latest history of each item. */
export async function listOperatorItems(tx: Tx, now = new Date(), options: { history?: boolean; includeTest?: boolean } = {}): Promise<OperatorItem[]> {
  // Test data is skipped in the queries themselves when not asked for, so hiding it also saves the work.
  const includeTest = options.includeTest ?? true;
  const drafts = [...(await heldImports(tx, includeTest)), ...(await emailItems(tx)), ...(await workerItems(tx, now)), ...(await pendingMatches(tx, includeTest)), ...(await suppressionItems(tx, now))].filter(
    (d) => includeTest || !d.isTest,
  );
  if (drafts.length === 0) return [];
  const ids = [...new Set(drafts.map((d) => d.subjectId))];

  const owners = await tx
    .select({ subjectType: operatorItem.subjectType, subjectId: operatorItem.subjectId, ownerUserId: operatorItem.ownerUserId, revision: operatorItem.revision, name: user.name })
    .from(operatorItem)
    .leftJoin(user, eq(user.id, operatorItem.ownerUserId))
    .where(inArray(operatorItem.subjectId, ids));
  const ownerByKey = new Map(owners.map((o) => [`${o.subjectType}:${o.subjectId}`, o]));

  const events =
    options.history === false
      ? []
      : await tx
          .select({ subjectType: auditEvent.subjectType, subjectId: auditEvent.subjectId, at: auditEvent.occurredAt, action: auditEvent.action, actorType: auditEvent.actorType, after: auditEvent.after, actorName: user.name })
          .from(auditEvent)
          .leftJoin(user, eq(user.id, auditEvent.actorUserId))
          // Both columns, so the (subject_type, subject_id) index is used.
          .where(and(inArray(auditEvent.subjectType, [...new Set(drafts.map((d) => d.subjectType))]), inArray(auditEvent.subjectId, ids)))
          .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
          .limit(5000);
  const historyByKey = new Map<string, HistoryEntry[]>();
  for (const e of events) {
    const key = `${e.subjectType}:${e.subjectId}`;
    const list = historyByKey.get(key) ?? [];
    if (list.length < 10) list.push({ at: e.at, action: e.action, actorName: e.actorName, actorType: e.actorType, detail: describeAudit(e.after) });
    historyByKey.set(key, list);
  }

  return drafts.map((d) => {
    const key = `${d.subjectType}:${d.subjectId}`;
    const o = ownerByKey.get(key);
    return {
      ...d,
      key,
      owner: o?.ownerUserId ? { userId: o.ownerUserId, name: o.name ?? "Unknown" } : null,
      revision: o?.revision ?? 0,
      history: historyByKey.get(key) ?? [],
    };
  });
}

/**
 * Queue age, delivery and bridge health for the Overview (SR-48, PDF 04):
 * a handful of counts, cheap enough for the landing page. Production data only.
 */
export async function healthSnapshot(tx: Tx, now = new Date()) {
  const [email] = await tx
    .select({
      queued: sql<number>`count(*) FILTER (WHERE ${emailIntent.state} = 'queued' AND ${emailIntent.dueAt} <= ${now})::int`,
      oldestDue: sql<Date | null>`min(${emailIntent.dueAt}) FILTER (WHERE ${emailIntent.state} = 'queued' AND ${emailIntent.dueAt} <= ${now})`,
      sent24h: sql<number>`count(*) FILTER (WHERE ${emailIntent.state} IN ('accepted', 'delivered') AND ${emailIntent.acceptedAt} > ${new Date(now.getTime() - 86_400_000)})::int`,
      problems: sql<number>`count(*) FILTER (WHERE ${emailIntent.state} IN ('failed', 'bounced', 'acceptance_unknown'))::int`,
    })
    .from(emailIntent)
    .where(eq(emailIntent.isTest, false));
  const [bridge] = await tx
    .select({
      waiting: sql<number>`count(*) FILTER (WHERE ${bridgeEvent.state} IN ('pending', 'retrying'))::int`,
      problems: sql<number>`count(*) FILTER (WHERE ${bridgeEvent.state} IN ('failed', 'conflict'))::int`,
      lastConfirmed: sql<Date | null>`max(${bridgeEvent.confirmedAt})`,
    })
    .from(bridgeEvent);
  const beat = await lastHeartbeat(tx);
  return {
    email: { ...email, oldestDue: email.oldestDue ? new Date(email.oldestDue) : null },
    bridge: { ...bridge, lastConfirmed: bridge.lastConfirmed ? new Date(bridge.lastConfirmed) : null },
    worker: { lastHeartbeat: beat, healthy: workerHealth(beat, now).ok },
  };
}

/** PSG staff who can work the queues and so may own an item. */
export async function listOperators(tx: Tx) {
  const rows = await tx.select({ userId: user.id, name: user.name, role: psgStaffRole.role }).from(psgStaffRole).innerJoin(user, eq(user.id, psgStaffRole.userId)).orderBy(asc(user.name));
  const byUser = new Map<string, { userId: string; name: string; roles: PsgRole[] }>();
  for (const r of rows) {
    const entry = byUser.get(r.userId) ?? { userId: r.userId, name: r.name, roles: [] };
    entry.roles.push(r.role);
    byUser.set(r.userId, entry);
  }
  return [...byUser.values()].filter((u) => hasCapability({ userId: u.userId, psgRoles: u.roles, shopIds: [] }, "operations.view")).map(({ userId, name }) => ({ userId, name }));
}

/** An item may only be owned while its subject exists; ids from the browser are never trusted. */
async function subjectExists(tx: Tx, subjectType: SubjectType, subjectId: string): Promise<boolean> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId);
  switch (subjectType) {
    case "worker":
      return subjectId === "heartbeat";
    case "worker_job":
      return uuid && (await pgBossPresent(tx)) && (await tx.execute(sql`SELECT 1 FROM pgboss.job WHERE id = ${subjectId}::uuid AND state = 'failed'`)).rows.length > 0;
    case "invitation":
      return uuid && (await tx.select({ id: invitation.id }).from(invitation).where(eq(invitation.id, subjectId))).length > 0;
    case "email_intent":
      return uuid && (await tx.select({ id: emailIntent.id }).from(emailIntent).where(eq(emailIntent.id, subjectId))).length > 0;
    case "survey_response":
      return uuid && (await tx.select({ id: surveyResponse.id }).from(surveyResponse).where(eq(surveyResponse.id, subjectId))).length > 0;
    case "suppression_action":
      return uuid && (await tx.select({ id: suppressionAction.id }).from(suppressionAction).where(eq(suppressionAction.id, subjectId))).length > 0;
  }
}

/** The shop an item belongs to, for the audit row; null for worker items or an unconfirmed shop. */
async function subjectShopId(tx: Tx, subjectType: SubjectType, subjectId: string): Promise<string | null> {
  if (subjectType === "invitation") return (await tx.select({ shopId: invitation.shopId }).from(invitation).where(eq(invitation.id, subjectId)))[0]?.shopId ?? null;
  if (subjectType === "survey_response") return (await tx.select({ shopId: surveyResponse.shopId }).from(surveyResponse).where(eq(surveyResponse.id, subjectId)))[0]?.shopId ?? null;
  if (subjectType === "suppression_action") {
    const [row] = await tx.select({ shopId: surveyResponse.shopId }).from(suppressionAction).innerJoin(surveyResponse, eq(surveyResponse.id, suppressionAction.responseId)).where(eq(suppressionAction.id, subjectId));
    return row?.shopId ?? null;
  }
  if (subjectType === "email_intent") {
    // Survey emails reach the shop through the invitation, alert emails through their case.
    const [row] = await tx
      .select({ shopId: sql<string | null>`COALESCE(${invitation.shopId}, ${alertCase.shopId})` })
      .from(emailIntent)
      .leftJoin(invitation, eq(invitation.id, emailIntent.invitationId))
      .leftJoin(alertApproval, eq(alertApproval.id, emailIntent.alertApprovalId))
      .leftJoin(alertCase, eq(alertCase.id, alertApproval.caseId))
      .where(eq(emailIntent.id, subjectId));
    return row?.shopId ?? null;
  }
  return null;
}

async function checkedSubject(tx: Tx, subjectType: string, subjectId: string): Promise<SubjectType> {
  if (!isSubjectType(subjectType) || !(await subjectExists(tx, subjectType, subjectId))) throw new OperationsError("not_found", "This item no longer exists. Reload the page.");
  return subjectType;
}

/** Lock the ownership row and check the caller saw its latest revision (0 means no row yet). */
async function lockItem(tx: Tx, subjectType: SubjectType, subjectId: string, expectedRevision: number) {
  const [row] = await tx
    .select()
    .from(operatorItem)
    .where(and(eq(operatorItem.subjectType, subjectType), eq(operatorItem.subjectId, subjectId)))
    .for("update");
  if ((row?.revision ?? 0) !== expectedRevision) throw new OperationsError("conflict", "Someone else changed this item. Reload the page.");
  return row ?? null;
}

/** Insert the first ownership row; a concurrent first write loses with a conflict instead of overwriting. */
async function insertItem(tx: Tx, values: typeof operatorItem.$inferInsert) {
  const [created] = await tx.insert(operatorItem).values(values).onConflictDoNothing().returning({ revision: operatorItem.revision });
  if (!created) throw new OperationsError("conflict", "Someone else changed this item. Reload the page.");
  return created.revision;
}

/**
 * Give an item a named owner, or clear it (SR-38). The owner must be PSG
 * staff who can work the queues. Audited on the item itself, so its history
 * shows every change of owner.
 */
export async function assignOwner(tx: Tx, actor: Actor, subjectTypeInput: string, subjectId: string, ownerUserId: string | null, expectedRevision: number, now = new Date()) {
  const subjectType = await checkedSubject(tx, subjectTypeInput, subjectId);
  let ownerName: string | null = null;
  if (ownerUserId) {
    const operator = (await listOperators(tx)).find((o) => o.userId === ownerUserId);
    if (!operator) throw new OperationsError("invalid", "Choose a PSG team member who works the operator queues.");
    ownerName = operator.name;
  }
  const row = await lockItem(tx, subjectType, subjectId, expectedRevision);
  if ((row?.ownerUserId ?? null) === ownerUserId) return { revision: row?.revision ?? 0 };

  const values = { ownerUserId, assignedAt: ownerUserId ? now : null, assignedBy: actor.userId, updatedAt: now };
  const revision = row
    ? (await tx.update(operatorItem).set({ ...values, revision: row.revision + 1 }).where(and(eq(operatorItem.subjectType, subjectType), eq(operatorItem.subjectId, subjectId))).returning({ revision: operatorItem.revision }))[0].revision
    : await insertItem(tx, { subjectType, subjectId, ...values });
  await recordAudit(
    {
      actorType: "user",
      actorUserId: actor.userId,
      shopId: await subjectShopId(tx, subjectType, subjectId),
      action: ownerUserId ? "operator.owner_assigned" : "operator.owner_cleared",
      subjectType,
      subjectId,
      before: { ownerUserId: row?.ownerUserId ?? null },
      after: { ownerUserId, ownerName },
    },
    tx,
  );
  return { revision };
}

/**
 * Record that a person looked at a failed background job and what they did
 * (AT-38: resolved under authorization). The job and its error stay in
 * pg-boss unchanged; the review only takes it off the queue.
 */
export async function reviewWorkerFailure(tx: Tx, actor: Actor, jobId: string, expectedRevision: number, note: string, now = new Date()) {
  await checkedSubject(tx, "worker_job", jobId);
  const trimmed = note.trim();
  if (trimmed.length < 5) throw new OperationsError("invalid", "Describe what you checked or fixed.");
  const row = await lockItem(tx, "worker_job", jobId, expectedRevision);
  if (row?.reviewedAt) throw new OperationsError("conflict", "This failure was already reviewed.");
  const values = { reviewedAt: now, reviewedBy: actor.userId, reviewNote: trimmed.slice(0, 1000), updatedAt: now };
  const revision = row
    ? (await tx.update(operatorItem).set({ ...values, revision: row.revision + 1 }).where(and(eq(operatorItem.subjectType, "worker_job"), eq(operatorItem.subjectId, jobId))).returning({ revision: operatorItem.revision }))[0].revision
    : await insertItem(tx, { subjectType: "worker_job", subjectId: jobId, ...values });
  await recordAudit({ actorType: "user", actorUserId: actor.userId, action: "operator.failure_reviewed", subjectType: "worker_job", subjectId: jobId, after: { note: trimmed.slice(0, 1000) } }, tx);
  return { revision };
}
