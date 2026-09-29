import "server-only";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { alertApproval, alertCase, caseNote, emailIntent, repairVisit, responseRevision, shop, shopSurveySettings, suppressionAction, surveyResponse, user } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import type { Outcomes } from "@/modules/instruments/evaluate";

/**
 * Negative-alert cases, follow-up and the interim suppression queue
 * (SR-32..SR-36). Runs inside the caller's transaction and does NOT
 * authorize: call through `cases.ts`.
 */

export type Actor = { type: "user"; userId: string } | { type: "system" };

export class CaseError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "CaseError";
  }
}

const actorId = (a: Actor) => (a.type === "user" ? a.userId : null);
const auditActor = (a: Actor) => (a.type === "user" ? { actorType: "user" as const, actorUserId: a.userId } : { actorType: "system" as const });

type AlertSnapshot = Outcomes["alerts"];
const alertKey = (alerts: AlertSnapshot) =>
  alerts
    .map((a) => a.id)
    .sort()
    .join(",");

// ---------------------------------------------------------------------------
// Raising work from outcomes (same transaction as the submission or correction)
// ---------------------------------------------------------------------------

/**
 * After a submission: a PSG review item for any fired alert (SR-32) and one
 * required suppression change per fired suppression rule (SR-36). Nothing is
 * emailed here; the shop sees the result at once anyway (SR-27).
 */
export async function raiseForSubmission(tx: Tx, responseId: string, now = new Date()) {
  const [r] = await tx.select().from(surveyResponse).where(eq(surveyResponse.id, responseId));
  const [rev] = await tx.select().from(responseRevision).where(eq(responseRevision.responseId, responseId)).orderBy(desc(responseRevision.revision)).limit(1);
  if (!r || !rev) return;
  const outcomes = rev.outcomes as Outcomes;
  if (outcomes.alerts.length > 0) {
    const [created] = await tx
      .insert(alertCase)
      .values({ responseId, shopId: r.shopId, isTest: r.isTest, alerts: outcomes.alerts, sourceRevision: rev.revision, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: alertCase.id });
    if (created) await recordAudit({ actorType: "system", shopId: r.shopId, action: "alert_case.created", subjectType: "alert_case", subjectId: created.id, after: { alerts: outcomes.alerts.map((a) => a.id) } }, tx);
  }
  for (const s of outcomes.suppressions) {
    await tx.insert(suppressionAction).values({ responseId, ruleId: s.id, ruleLabel: s.label, desired: "apply", sourceRevision: rev.revision, isTest: r.isTest, createdAt: now });
  }
}

/**
 * After a correction (AT-20): alert and suppression changes are made explicit
 * for review. An already approved alert is never re-sent by itself; it
 * returns to review so any new outreach is a new, deliberate approval.
 */
export async function raiseForCorrection(tx: Tx, responseId: string, before: Outcomes, after: Outcomes, revision: number, now = new Date()) {
  const [r] = await tx.select().from(surveyResponse).where(eq(surveyResponse.id, responseId));
  if (!r) return { alertsChanged: false, suppressionsChanged: false };
  const alertsChanged = alertKey(before.alerts) !== alertKey(after.alerts);
  if (alertsChanged) {
    const [existing] = await tx.select().from(alertCase).where(eq(alertCase.responseId, responseId)).for("update");
    if (!existing) {
      if (after.alerts.length > 0) {
        await tx.insert(alertCase).values({ responseId, shopId: r.shopId, isTest: r.isTest, alerts: after.alerts, sourceRevision: revision, createdAt: now, updatedAt: now });
      }
    } else {
      const wasReviewed = existing.status !== "pending_review";
      await tx
        .update(alertCase)
        .set({
          alerts: after.alerts,
          sourceRevision: revision,
          status: "pending_review",
          outcomeChangedAt: wasReviewed ? now : existing.outcomeChangedAt,
          revision: existing.revision + 1,
          updatedAt: now,
        })
        .where(eq(alertCase.id, existing.id));
      await recordAudit(
        { actorType: "system", shopId: existing.shopId, action: "alert_case.outcome_changed", subjectType: "alert_case", subjectId: existing.id, before: { alerts: before.alerts.map((a) => a.id), status: existing.status }, after: { alerts: after.alerts.map((a) => a.id), revision } },
        tx,
      );
    }
  }
  const beforeIds = new Set(before.suppressions.map((s) => s.id));
  const afterIds = new Set(after.suppressions.map((s) => s.id));
  const added = after.suppressions.filter((s) => !beforeIds.has(s.id));
  const removed = before.suppressions.filter((s) => !afterIds.has(s.id));
  for (const s of added) await tx.insert(suppressionAction).values({ responseId, ruleId: s.id, ruleLabel: s.label, desired: "apply", sourceRevision: revision, isTest: r.isTest, createdAt: now });
  // A reversal is its own required action, never an edit of the earlier one (AT-36).
  for (const s of removed) await tx.insert(suppressionAction).values({ responseId, ruleId: s.id, ruleLabel: s.label, desired: "remove", sourceRevision: revision, isTest: r.isTest, createdAt: now });
  return { alertsChanged, suppressionsChanged: added.length + removed.length > 0 };
}

/** When PSG confirms a response's shop, its case follows (AT-29: outreach needs a confirmed shop). */
export async function shopConfirmed(tx: Tx, responseId: string, shopId: string) {
  await tx.update(alertCase).set({ shopId, updatedAt: new Date() }).where(eq(alertCase.responseId, responseId));
}

// ---------------------------------------------------------------------------
// Review and Approve & Send (SR-32, SR-33)
// ---------------------------------------------------------------------------

async function lockCase(tx: Tx, caseId: string, expectedRevision: number) {
  const [c] = await tx.select().from(alertCase).where(eq(alertCase.id, caseId)).for("update");
  if (!c) throw new CaseError("not_found", "This case no longer exists.");
  if (c.revision !== expectedRevision) throw new CaseError("conflict", "Someone else changed this case. Reload to see the latest.");
  return c;
}

const recipientsSchema = z
  .array(z.string().trim().toLowerCase().pipe(z.email("Each recipient must be an email address")))
  .min(1, "Add at least one recipient")
  .max(20, "Use at most 20 recipients")
  .transform((l) => [...new Set(l)]);

/**
 * Approve a case and queue one email per recipient. The recipient snapshot
 * belongs to this approval only; the shop's saved list is not changed
 * (AT-33). A stale or repeated click cannot approve twice.
 */
export async function approveAndSend(tx: Tx, actor: Actor, caseId: string, expectedRevision: number, recipientsInput: string[], note: string, now = new Date()) {
  const c = await lockCase(tx, caseId, expectedRevision);
  if (c.status !== "pending_review") throw new CaseError("conflict", "This case is not waiting for review.");
  if (!c.shopId) throw new CaseError("invalid", "Confirm the response's shop before any outreach.");
  const parsed = recipientsSchema.safeParse(recipientsInput);
  if (!parsed.success) throw new CaseError("invalid", parsed.error.issues[0]?.message ?? "Check the recipients.");
  const recipients = parsed.data;
  const [settings] = await tx.select({ saved: shopSurveySettings.alertRecipients }).from(shopSurveySettings).where(eq(shopSurveySettings.shopId, c.shopId));
  const [{ n }] = await tx.select({ n: count() }).from(alertApproval).where(eq(alertApproval.caseId, caseId));

  const [approval] = await tx
    .insert(alertApproval)
    .values({ caseId, approvalNumber: n + 1, recipients, savedRecipients: settings?.saved ?? [], sourceRevision: c.sourceRevision, note: note.trim() || null, approvedBy: actorId(actor), approvedAt: now })
    .returning();
  await tx
    .update(alertCase)
    .set({ status: "approved", reviewedBy: actorId(actor), reviewedAt: now, reviewNote: note.trim() || null, followUp: c.followUp === "none" ? "open" : c.followUp, revision: c.revision + 1, updatedAt: now })
    .where(eq(alertCase.id, caseId));
  for (const recipient of recipients) {
    await tx.insert(emailIntent).values({
      alertApprovalId: approval.id,
      kind: "alert",
      idempotencyKey: `alert:${approval.id}:${recipient}`,
      recipient,
      isTest: c.isTest,
      createdBy: actorId(actor),
      createdAt: now,
      updatedAt: now,
      dueAt: now,
    });
  }
  const adjusted = JSON.stringify([...recipients].sort()) !== JSON.stringify([...(settings?.saved ?? [])].sort());
  await recordAudit(
    { ...auditActor(actor), shopId: c.shopId, action: "alert_case.approved", subjectType: "alert_case", subjectId: caseId, after: { approvalId: approval.id, approvalNumber: approval.approvalNumber, recipients, adjustedFromSaved: adjusted, sourceRevision: c.sourceRevision } },
    tx,
  );
  return approval;
}

/** PSG decides no outreach is needed. The shop still sees the result (SR-27). */
export async function dismissCase(tx: Tx, actor: Actor, caseId: string, expectedRevision: number, note: string, now = new Date()) {
  const c = await lockCase(tx, caseId, expectedRevision);
  if (c.status !== "pending_review") throw new CaseError("conflict", "This case is not waiting for review.");
  if (note.trim().length < 5) throw new CaseError("invalid", "Say why no outreach is needed.");
  await tx.update(alertCase).set({ status: "dismissed", reviewedBy: actorId(actor), reviewedAt: now, reviewNote: note.trim(), revision: c.revision + 1, updatedAt: now }).where(eq(alertCase.id, caseId));
  await recordAudit({ ...auditActor(actor), shopId: c.shopId, action: "alert_case.dismissed", subjectType: "alert_case", subjectId: caseId, after: { note: note.trim() } }, tx);
}

// ---------------------------------------------------------------------------
// Follow-up (SR-34)
// ---------------------------------------------------------------------------

export async function addNote(tx: Tx, actor: Actor, caseId: string, input: { body: string; visibility: "shop" | "internal"; authorKind: "psg" | "shop" }, now = new Date()) {
  const body = input.body.trim();
  if (body.length < 2) throw new CaseError("invalid", "Write a note first.");
  if (body.length > 4000) throw new CaseError("invalid", "Keep the note under 4,000 characters.");
  // Shop notes are always visible to the shop; only PSG can write internal notes (P-07).
  if (input.authorKind === "shop" && input.visibility !== "shop") throw new CaseError("invalid", "Shop notes are shared notes.");
  const [c] = await tx.select().from(alertCase).where(eq(alertCase.id, caseId));
  if (!c) throw new CaseError("not_found", "This case no longer exists.");
  const [note] = await tx.insert(caseNote).values({ caseId, authorUserId: actorId(actor), authorKind: input.authorKind, visibility: input.visibility, body, createdAt: now }).returning({ id: caseNote.id });
  await recordAudit({ ...auditActor(actor), shopId: c.shopId, action: "case_note.added", subjectType: "alert_case", subjectId: caseId, after: { noteId: note.id, visibility: input.visibility } }, tx);
}

/** A shop asks PSG to close the case. It stays open until PSG resolves it (AT-34). */
export async function requestClosure(tx: Tx, actor: Actor, caseId: string, expectedRevision: number, note: string, now = new Date()) {
  const c = await lockCase(tx, caseId, expectedRevision);
  if (c.followUp !== "open") throw new CaseError("conflict", "This case is not open for follow-up.");
  if (note.trim().length < 5) throw new CaseError("invalid", "Tell PSG what the shop did.");
  await tx.insert(caseNote).values({ caseId, authorUserId: actorId(actor), authorKind: "shop", visibility: "shop", body: `Closure requested: ${note.trim()}`, createdAt: now });
  await tx.update(alertCase).set({ followUp: "closure_requested", closureRequestedBy: actorId(actor), closureRequestedAt: now, revision: c.revision + 1, updatedAt: now }).where(eq(alertCase.id, caseId));
  await recordAudit({ ...auditActor(actor), shopId: c.shopId, action: "alert_case.closure_requested", subjectType: "alert_case", subjectId: caseId }, tx);
}

export const RESOLUTION_OUTCOMES = {
  resolved_with_customer: "Resolved with the customer",
  customer_unreachable: "Customer could not be reached",
  no_action_needed: "No further action needed",
} as const;
export type ResolutionOutcome = keyof typeof RESOLUTION_OUTCOMES;

/** Only PSG confirms final resolution, with a recorded outcome (SR-34). */
export async function resolveCase(tx: Tx, actor: Actor, caseId: string, expectedRevision: number, outcome: ResolutionOutcome, note: string, now = new Date()) {
  const c = await lockCase(tx, caseId, expectedRevision);
  if (c.followUp !== "open" && c.followUp !== "closure_requested") throw new CaseError("conflict", "This case is not open for follow-up.");
  if (!(outcome in RESOLUTION_OUTCOMES)) throw new CaseError("invalid", "Choose the outcome.");
  if (note.trim()) await tx.insert(caseNote).values({ caseId, authorUserId: actorId(actor), authorKind: "psg", visibility: "shop", body: `Resolved: ${note.trim()}`, createdAt: now });
  await tx.update(alertCase).set({ followUp: "resolved", resolutionOutcome: outcome, resolvedBy: actorId(actor), resolvedAt: now, revision: c.revision + 1, updatedAt: now }).where(eq(alertCase.id, caseId));
  await recordAudit({ ...auditActor(actor), shopId: c.shopId, action: "alert_case.resolved", subjectType: "alert_case", subjectId: caseId, after: { outcome, note: note.trim() || null } }, tx);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type CaseView = "review" | "follow_up" | "closure_requested" | "resolved" | "dismissed";

function caseWhere(view: CaseView, shopId?: string) {
  return and(
    view === "review" ? eq(alertCase.status, "pending_review") : undefined,
    view === "follow_up" ? eq(alertCase.followUp, "open") : undefined,
    view === "closure_requested" ? eq(alertCase.followUp, "closure_requested") : undefined,
    view === "resolved" ? eq(alertCase.followUp, "resolved") : undefined,
    view === "dismissed" ? eq(alertCase.status, "dismissed") : undefined,
    shopId ? eq(alertCase.shopId, shopId) : undefined,
  );
}

export async function countCases(tx: Tx, view: CaseView) {
  const [row] = await tx.select({ n: count() }).from(alertCase).where(caseWhere(view));
  return row.n;
}

export async function listCases(tx: Tx, view: CaseView, offset: number, size: number) {
  return tx
    .select({ case: alertCase, shopName: shop.name, submittedAt: surveyResponse.submittedAt, matchStatus: surveyResponse.matchStatus, source: surveyResponse.source })
    .from(alertCase)
    .innerJoin(surveyResponse, eq(surveyResponse.id, alertCase.responseId))
    .leftJoin(shop, eq(shop.id, alertCase.shopId))
    .where(caseWhere(view))
    .orderBy(asc(alertCase.createdAt), asc(alertCase.id))
    .limit(size)
    .offset(offset);
}

export async function caseCounts(tx: Tx) {
  const [row] = await tx
    .select({
      review: sql<number>`count(*) FILTER (WHERE ${alertCase.status} = 'pending_review')::int`,
      followUp: sql<number>`count(*) FILTER (WHERE ${alertCase.followUp} = 'open')::int`,
      closure: sql<number>`count(*) FILTER (WHERE ${alertCase.followUp} = 'closure_requested')::int`,
    })
    .from(alertCase);
  return row;
}

export async function getCase(tx: Tx, caseId: string) {
  const [row] = await tx
    .select({ case: alertCase, shopName: shop.name, response: surveyResponse, visitKey: repairVisit.sourceVisitKey })
    .from(alertCase)
    .innerJoin(surveyResponse, eq(surveyResponse.id, alertCase.responseId))
    .leftJoin(shop, eq(shop.id, alertCase.shopId))
    .leftJoin(repairVisit, eq(repairVisit.id, surveyResponse.visitId))
    .where(eq(alertCase.id, caseId));
  if (!row) return null;
  const approvals = await tx
    .select({ approval: alertApproval, approverName: user.name })
    .from(alertApproval)
    .leftJoin(user, eq(user.id, alertApproval.approvedBy))
    .where(eq(alertApproval.caseId, caseId))
    .orderBy(asc(alertApproval.approvalNumber));
  const deliveries = approvals.length
    ? await tx
        .select({ approvalId: emailIntent.alertApprovalId, recipient: emailIntent.recipient, state: emailIntent.state, stateReason: emailIntent.stateReason, acceptedAt: emailIntent.acceptedAt })
        .from(emailIntent)
        .where(
          inArray(
            emailIntent.alertApprovalId,
            approvals.map((a) => a.approval.id),
          ),
        )
    : [];
  const notes = await tx
    .select({ note: caseNote, authorName: user.name })
    .from(caseNote)
    .leftJoin(user, eq(user.id, caseNote.authorUserId))
    .where(eq(caseNote.caseId, caseId))
    .orderBy(asc(caseNote.id));
  const [reviewer] = row.case.reviewedBy ? await tx.select({ name: user.name }).from(user).where(eq(user.id, row.case.reviewedBy)) : [];
  const [resolver] = row.case.resolvedBy ? await tx.select({ name: user.name }).from(user).where(eq(user.id, row.case.resolvedBy)) : [];
  const [saved] = row.case.shopId ? await tx.select({ list: shopSurveySettings.alertRecipients }).from(shopSurveySettings).where(eq(shopSurveySettings.shopId, row.case.shopId)) : [];
  return { ...row, approvals, deliveries, notes, reviewerName: reviewer?.name ?? null, resolverName: resolver?.name ?? null, savedRecipients: saved?.list ?? [] };
}

export async function caseForResponse(tx: Tx, responseId: string) {
  const [c] = await tx.select({ id: alertCase.id, status: alertCase.status, followUp: alertCase.followUp, shopId: alertCase.shopId }).from(alertCase).where(eq(alertCase.responseId, responseId));
  return c ?? null;
}

/** The shop's cases: only after PSG approved outreach, and only their own (SR-34). Internal notes are removed. */
const shopCaseWhere = (shopId: string) => and(eq(alertCase.shopId, shopId), eq(alertCase.status, "approved"));

export async function countShopCases(tx: Tx, shopId: string) {
  const [row] = await tx.select({ n: count() }).from(alertCase).where(shopCaseWhere(shopId));
  return row.n;
}

export async function listShopCases(tx: Tx, shopId: string, offset: number, size: number) {
  return tx
    .select({ case: alertCase, submittedAt: surveyResponse.submittedAt })
    .from(alertCase)
    .innerJoin(surveyResponse, eq(surveyResponse.id, alertCase.responseId))
    .where(shopCaseWhere(shopId))
    .orderBy(desc(alertCase.createdAt), desc(alertCase.id))
    .limit(size)
    .offset(offset);
}

export async function getShopCase(tx: Tx, shopId: string, caseId: string) {
  const full = await getCase(tx, caseId);
  if (!full || full.case.shopId !== shopId || full.case.status !== "approved") return null;
  return { ...full, notes: full.notes.filter((n) => n.note.visibility === "shop"), approvals: [], deliveries: [] };
}

// ---------------------------------------------------------------------------
// Interim suppression queue (SR-36)
// ---------------------------------------------------------------------------

export const SUPPRESSION_RESULTS = { applied: "Applied in FileMaker", not_needed: "Checked: no change was needed" } as const;
export type SuppressionResult = keyof typeof SUPPRESSION_RESULTS;

export async function countSuppressions(tx: Tx, status: "outstanding" | "acknowledged") {
  const [row] = await tx.select({ n: count() }).from(suppressionAction).where(eq(suppressionAction.status, status));
  return row.n;
}

/** Without a page this is every outstanding change: the operator queue must never miss one. */
export async function listSuppressions(tx: Tx, status: "outstanding" | "acknowledged", page?: { offset: number; size: number }) {
  const rows = tx
    .select({ action: suppressionAction, shopName: shop.name, visitKey: repairVisit.sourceVisitKey, sourceSystem: repairVisit.sourceSystem, ackName: user.name })
    .from(suppressionAction)
    .innerJoin(surveyResponse, eq(surveyResponse.id, suppressionAction.responseId))
    .leftJoin(shop, eq(shop.id, surveyResponse.shopId))
    .leftJoin(repairVisit, eq(repairVisit.id, surveyResponse.visitId))
    .leftJoin(user, eq(user.id, suppressionAction.acknowledgedBy))
    .where(eq(suppressionAction.status, status))
    .orderBy(status === "outstanding" ? asc(suppressionAction.createdAt) : desc(suppressionAction.acknowledgedAt), asc(suppressionAction.id))
    .$dynamic();
  return page ? rows.limit(page.size).offset(page.offset) : rows;
}

/**
 * Record that an operator applied (or checked) one identified change in
 * FileMaker. Only an action whose visit is known can be acknowledged (AT-36).
 */
export async function acknowledgeSuppression(tx: Tx, actor: Actor, actionId: string, expectedRevision: number, result: SuppressionResult, evidence: string, now = new Date()) {
  const [row] = await tx
    .select({ action: suppressionAction, visitId: surveyResponse.visitId, shopId: surveyResponse.shopId })
    .from(suppressionAction)
    .innerJoin(surveyResponse, eq(surveyResponse.id, suppressionAction.responseId))
    .where(eq(suppressionAction.id, actionId))
    .for("update", { of: suppressionAction });
  if (!row) throw new CaseError("not_found", "This suppression change no longer exists.");
  if (row.action.status !== "outstanding") throw new CaseError("conflict", "This change was already acknowledged.");
  if (row.action.revision !== expectedRevision) throw new CaseError("conflict", "This change was updated. Reload the page.");
  if (!row.visitId) throw new CaseError("invalid", "Match the response to its visit first, so the exact FileMaker record is known.");
  if (!(result in SUPPRESSION_RESULTS)) throw new CaseError("invalid", "Choose what happened.");
  if (evidence.trim().length < 5) throw new CaseError("invalid", "Record what you did in FileMaker.");
  await tx
    .update(suppressionAction)
    .set({ status: "acknowledged", acknowledgedBy: actorId(actor), acknowledgedAt: now, result, evidence: evidence.trim(), revision: row.action.revision + 1 })
    .where(eq(suppressionAction.id, actionId));
  await recordAudit({ ...auditActor(actor), shopId: row.shopId, action: "suppression.acknowledged", subjectType: "suppression_action", subjectId: actionId, after: { result, evidence: evidence.trim() } }, tx);
}
