import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  customer,
  instrumentVersion,
  invitation,
  matchDecision,
  repairVisit,
  responseRevision,
  shop,
  shopSuggestion,
  shopSurveySettings,
  surveyResponse,
  user,
} from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { raiseForCorrection, raiseForSubmission, shopConfirmed } from "@/modules/cases/store";
import { cancelAfterSubmission } from "@/modules/email-ledger/store";
import { definitionHash } from "@/modules/instruments/canonical";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import { allQuestions } from "@/modules/instruments/questions";
import { evaluateSubmission, type AnswerError, type Answers, type Outcomes } from "@/modules/instruments/evaluate";
import { loadSurvey, UnpublishedSurveyError } from "@/modules/instruments/survey";
import { isIsoDate } from "@/modules/shops/settings-policy";
import { placeForVisit } from "./placement";

/**
 * Staff and public response paths (SR-13, SR-18..SR-20, SR-28, SR-29). Every
 * path uses the same evaluator as online surveys. Runs inside the caller's
 * transaction and does NOT authorize: call through `staff.ts` / `public.ts`.
 */

export type Actor = { type: "user"; userId: string } | { type: "system" };

export class StaffResponseError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
    readonly errors: AnswerError[] = [],
  ) {
    super(message);
    this.name = "StaffResponseError";
  }
}

/** Treat user text literally in LIKE patterns. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const actorId = (actor: Actor) => (actor.type === "user" ? actor.userId : null);
const auditActor = (actor: Actor) => (actor.type === "user" ? { actorType: "user" as const, actorUserId: actor.userId } : { actorType: "system" as const });

/** The pinned core survey plus the shop's own questions, if any (SR-45). Scoring uses the core only. */
async function loadVersion(tx: Tx, versionId: string, additionVersionId: string | null) {
  try {
    const survey = await loadSurvey(tx, versionId, additionVersionId);
    return { survey, definition: survey.definition, hash: survey.core.definitionHash, isTest: survey.core.isTest || Boolean(survey.addition?.isTest) };
  } catch (error) {
    if (error instanceof UnpublishedSurveyError) throw new StaffResponseError("invalid", "This survey version is not published.");
    throw error;
  }
}

/**
 * Serialize concurrent requests with the same submit key (double click, retry)
 * so the replay check below sees the first insert; the unique index is the backstop.
 */
const lockRequestKey = (tx: Tx, source: "paper" | "public", key: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`submit:${source}:${key}`}, 0))`);

/** Whether a shop's new responses are test data: internal shops, Test mode, or a TEST version (SR-03). */
async function shopContext(tx: Tx, shopId: string) {
  const [row] = await tx.select({ shop, settings: shopSurveySettings }).from(shop).innerJoin(shopSurveySettings, eq(shopSurveySettings.shopId, shop.id)).where(eq(shop.id, shopId));
  if (!row || row.shop.archivedAt) throw new StaffResponseError("not_found", "This shop no longer exists.");
  return row;
}

// ---------------------------------------------------------------------------
// Paper entry (SR-18)
// ---------------------------------------------------------------------------

export interface PaperInput {
  shopId: string;
  visitId: string | null;
  receivedOn: string;
  answers: unknown;
  requestKey: string;
}

/**
 * Enter a paper survey. With a visit it uses the visit's pinned invitation
 * version; without one it uses the shop's assigned version and waits for
 * matching. Same validation and scoring as online (AT-18).
 */
export async function submitPaper(tx: Tx, actor: Actor, input: PaperInput, now = new Date()) {
  if (!isIsoDate(input.receivedOn)) throw new StaffResponseError("invalid", "Enter the date the paper form was received.");
  if (input.receivedOn > now.toISOString().slice(0, 10)) throw new StaffResponseError("invalid", "The received date cannot be in the future.");

  // Same request key from the same person replays the original entry (double click, retry);
  // the same key with different answers is refused (PDF 05: same key, different body).
  await lockRequestKey(tx, "paper", input.requestKey);
  const [replay] = await tx
    .select({ id: surveyResponse.id, hash: surveyResponse.submitPayloadHash, versionId: surveyResponse.instrumentVersionId, additionVersionId: surveyResponse.additionVersionId, enteredBy: surveyResponse.enteredBy })
    .from(surveyResponse)
    .where(and(eq(surveyResponse.source, "paper"), eq(surveyResponse.submitRequestKey, input.requestKey)));
  if (replay) {
    const { definition } = await loadVersion(tx, replay.versionId, replay.additionVersionId);
    const again = evaluateSubmission(definition, input.answers);
    const same = replay.enteredBy === actorId(actor) && again.ok && definitionHash(again.answers) === replay.hash;
    if (!same) throw new StaffResponseError("conflict", "This paper form was already saved with different answers. Reload the page to enter a new one.");
    return { responseId: replay.id, replayed: true };
  }

  const ctx = await shopContext(tx, input.shopId);
  let versionId: string | null = ctx.settings.instrumentVersionId;
  let additionVersionId: string | null = ctx.settings.additionVersionId;
  let isTest = ctx.shop.isTestShop || ctx.settings.mode === "test";
  let invitationId: string | null = null;
  if (input.visitId) {
    const [visit] = await tx
      .select({ visit: repairVisit, invitationId: invitation.id, versionId: invitation.instrumentVersionId, additionVersionId: invitation.additionVersionId })
      .from(repairVisit)
      .leftJoin(invitation, eq(invitation.visitId, repairVisit.id))
      .where(and(eq(repairVisit.id, input.visitId), eq(repairVisit.shopId, input.shopId)));
    if (!visit) throw new StaffResponseError("not_found", "That visit is not at this shop.");
    isTest = visit.visit.isTest;
    invitationId = visit.invitationId;
    // The visit's own pinned survey, exactly as its customer would have seen it.
    if (visit.versionId) [versionId, additionVersionId] = [visit.versionId, visit.additionVersionId];
  }
  if (!versionId) throw new StaffResponseError("invalid", "Assign a survey version to this shop first.");
  const { survey, definition, hash, isTest: versionIsTest } = await loadVersion(tx, versionId, additionVersionId);
  isTest = isTest || versionIsTest;

  const evaluated = evaluateSubmission(definition, input.answers);
  if (!evaluated.ok) throw new StaffResponseError("invalid", "Some answers need attention.", evaluated.errors);

  const placement = input.visitId ? await placeForVisit(tx, input.visitId) : ({ matchStatus: "visit_unmatched", canonical: false, duplicateDisposition: null } as const);
  const [created] = await tx
    .insert(surveyResponse)
    .values({
      invitationId,
      shopId: input.shopId,
      visitId: input.visitId,
      instrumentVersionId: survey.core.id,
      additionVersionId: survey.addition?.id ?? null,
      source: "paper",
      status: "submitted",
      isTest,
      draftAnswers: evaluated.answers,
      submittedAt: now,
      submitRequestKey: input.requestKey,
      submitPayloadHash: definitionHash(evaluated.answers),
      receivedOn: input.receivedOn,
      enteredBy: actorId(actor),
      ...placement,
    })
    .returning({ id: surveyResponse.id });
  await tx.insert(responseRevision).values({
    responseId: created.id,
    revision: 1,
    answers: evaluated.answers,
    outcomes: evaluated.outcomes,
    definitionHash: hash,
    evaluatorVersion: evaluated.outcomes.evaluatorVersion,
    ...auditActor(actor),
    reason: "Paper form entry",
  });
  if (invitationId && placement.canonical) await cancelAfterSubmission(tx, invitationId, now);
  await raiseForSubmission(tx, created.id, now);
  await recordAudit(
    {
      ...auditActor(actor),
      shopId: input.shopId,
      action: "response.paper_entered",
      subjectType: "survey_response",
      subjectId: created.id,
      after: { source: "paper", receivedOn: input.receivedOn, visitId: input.visitId, matchStatus: placement.matchStatus, canonical: placement.canonical, isTest },
    },
    tx,
  );
  return { responseId: created.id, replayed: false };
}

// ---------------------------------------------------------------------------
// Public shop form (SR-13)
// ---------------------------------------------------------------------------

export const CONTEXT_FIELDS = ["name", "repairOrder", "repairDate", "contact"] as const;
export type RespondentContext = Partial<Record<(typeof CONTEXT_FIELDS)[number], string>>;

/** Only the known identifier fields, trimmed and bounded. */
function cleanContext(input: unknown): RespondentContext {
  const out: RespondentContext = {};
  if (!input || typeof input !== "object") return out;
  for (const key of CONTEXT_FIELDS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 200);
  }
  return out;
}

export async function publicShopForm(tx: Tx, slug: string) {
  const [row] = await tx
    .select({ shop, settings: shopSurveySettings })
    .from(shop)
    .innerJoin(shopSurveySettings, eq(shopSurveySettings.shopId, shop.id))
    .where(eq(shop.publicSlug, slug));
  if (!row || row.shop.archivedAt || !row.settings.instrumentVersionId) return null;
  const { survey, definition, hash, isTest } = await loadVersion(tx, row.settings.instrumentVersionId, row.settings.additionVersionId);
  return {
    shop: { id: row.shop.id, name: row.shop.name, logoUrl: row.shop.logoUrl, brandColor: row.shop.brandColor },
    isTest: row.shop.isTestShop || row.settings.mode === "test" || isTest,
    versionId: survey.core.id,
    additionVersionId: survey.addition?.id ?? null,
    definitionHash: hash,
    definition,
  };
}

/**
 * A public response is saved with its shop fixed from the URL, even when no
 * visit is known, and waits for PSG matching. Nothing about other customers
 * is looked up or returned (AT-13).
 */
export async function submitPublic(tx: Tx, input: { slug: string; versionId: string; additionVersionId?: string | null; answers: unknown; context: unknown; requestKey: string }, now = new Date()) {
  const form = await publicShopForm(tx, input.slug);
  if (!form) return { ok: false as const, reason: "unavailable" as const };
  // The survey changed while the respondent was answering: they reload rather than submit to the wrong questions.
  if (form.versionId !== input.versionId || form.additionVersionId !== (input.additionVersionId ?? null)) return { ok: false as const, reason: "changed" as const };

  await lockRequestKey(tx, "public", input.requestKey);
  const [replay] = await tx
    .select({ id: surveyResponse.id, hash: surveyResponse.submitPayloadHash, shopId: surveyResponse.shopId })
    .from(surveyResponse)
    .where(and(eq(surveyResponse.source, "public"), eq(surveyResponse.submitRequestKey, input.requestKey)));

  const evaluated = evaluateSubmission(form.definition, input.answers);
  if (!evaluated.ok) return { ok: false as const, reason: "invalid" as const, errors: evaluated.errors };
  const payloadHash = definitionHash(evaluated.answers);
  if (replay) return replay.shopId === form.shop.id && replay.hash === payloadHash ? { ok: true as const, replayed: true } : { ok: false as const, reason: "already_submitted" as const };

  const [created] = await tx
    .insert(surveyResponse)
    .values({
      shopId: form.shop.id,
      instrumentVersionId: form.versionId,
      additionVersionId: form.additionVersionId,
      source: "public",
      status: "submitted",
      isTest: form.isTest,
      draftAnswers: evaluated.answers,
      submittedAt: now,
      submitRequestKey: input.requestKey,
      submitPayloadHash: payloadHash,
      respondentContext: cleanContext(input.context),
      matchStatus: "visit_unmatched",
      canonical: false,
    })
    .returning({ id: surveyResponse.id });
  await tx.insert(responseRevision).values({
    responseId: created.id,
    revision: 1,
    answers: evaluated.answers,
    outcomes: evaluated.outcomes,
    definitionHash: form.definitionHash,
    evaluatorVersion: evaluated.outcomes.evaluatorVersion,
    actorType: "respondent",
  });
  await recordAudit({ actorType: "respondent", shopId: form.shop.id, action: "response.public_submitted", subjectType: "survey_response", subjectId: created.id, after: { isTest: form.isTest } }, tx);
  // Negative feedback from an unmatched response still reaches PSG review at once (SR-28).
  await raiseForSubmission(tx, created.id, now);
  return { ok: true as const, replayed: false };
}

// ---------------------------------------------------------------------------
// Matching, shop confirmation and duplicates (SR-19, SR-28, SR-29)
// ---------------------------------------------------------------------------

async function lockResponse(tx: Tx, responseId: string, expectedMatchRevision: number) {
  const [r] = await tx.select().from(surveyResponse).where(eq(surveyResponse.id, responseId)).for("update");
  if (!r || r.status !== "submitted") throw new StaffResponseError("not_found", "This response no longer exists.");
  if (r.matchRevision !== expectedMatchRevision) throw new StaffResponseError("conflict", "This response changed since you opened it. Reload the page.");
  return r;
}

async function decide(tx: Tx, actor: Actor, responseId: string, kind: string, fields: { shopId?: string | null; visitId?: string | null; otherResponseId?: string | null; evidence?: string | null }) {
  await tx.insert(matchDecision).values({ responseId, kind, actorUserId: actorId(actor), shopId: fields.shopId ?? null, visitId: fields.visitId ?? null, otherResponseId: fields.otherResponseId ?? null, evidence: fields.evidence?.trim() || null });
}

export interface CandidateVisit {
  visitId: string;
  sourceVisitKey: string;
  repairOrder: string | null;
  deliveredOn: string | null;
  customerName: string;
  evidence: string[];
  hasCountedResponse: boolean;
}

/**
 * Visits at the response's shop that fit what the respondent said, each with
 * the concrete evidence for it. No numeric confidence (PDF 03 section 4).
 */
export async function candidateVisits(tx: Tx, responseId: string, search?: string): Promise<CandidateVisit[]> {
  const [r] = await tx.select().from(surveyResponse).where(eq(surveyResponse.id, responseId));
  if (!r?.shopId) return [];
  const ctx = (r.respondentContext ?? {}) as RespondentContext;
  const terms = [ctx.repairOrder, search].filter((t): t is string => Boolean(t && t.trim().length >= 2)).map((t) => t.trim());
  const nameParts = (ctx.name ?? "").split(/\s+/).filter((p) => p.length >= 2);
  const contact = ctx.contact?.trim().toLowerCase() ?? "";

  const filters = [
    ...terms
      .map(likeEscape)
      .flatMap((t) => [ilike(repairVisit.sourceVisitKey, t), ilike(repairVisit.repairOrder, t), ilike(customer.lastName, `%${t}%`), ilike(customer.emailNormalized, t.toLowerCase())]),
    ...nameParts.map((p) => ilike(customer.lastName, likeEscape(p))),
    ...(contact.includes("@") ? [eq(customer.emailNormalized, contact)] : []),
  ];
  if (filters.length === 0) return [];

  const rows = await tx
    .select({ visit: repairVisit, firstName: customer.firstName, lastName: customer.lastName, email: customer.emailNormalized })
    .from(repairVisit)
    .innerJoin(customer, eq(customer.id, repairVisit.customerId))
    .where(and(eq(repairVisit.shopId, r.shopId), eq(repairVisit.isTest, r.isTest), or(...filters)))
    .orderBy(desc(repairVisit.createdAt))
    .limit(20);
  const counted = rows.length
    ? new Set(
        (
          await tx
            .select({ visitId: surveyResponse.visitId })
            .from(surveyResponse)
            .where(
              and(
                inArray(
                  surveyResponse.visitId,
                  rows.map((x) => x.visit.id),
                ),
                eq(surveyResponse.canonical, true),
              ),
            )
        ).map((x) => x.visitId),
      )
    : new Set();

  const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();
  return rows.map(({ visit, firstName, lastName, email }) => {
    const evidence: string[] = [];
    for (const t of terms) {
      if (lower(visit.sourceVisitKey) === lower(t)) evidence.push(`Visit ID ${visit.sourceVisitKey} equals "${t}"`);
      if (visit.repairOrder && lower(visit.repairOrder) === lower(t)) evidence.push(`Repair order ${visit.repairOrder} equals "${t}"`);
    }
    if (lastName && nameParts.some((p) => lower(p) === lower(lastName))) evidence.push(`Last name ${lastName} is in the name given`);
    if (email && contact === email) evidence.push("Email matches the contact given");
    if (ctx.repairDate && visit.deliveredOn && Math.abs(Date.parse(ctx.repairDate) - Date.parse(visit.deliveredOn)) <= 14 * 86400000) evidence.push(`Delivered ${visit.deliveredOn}, near the date given`);
    if (evidence.length === 0 && search) evidence.push(`Found by your search "${search}"`);
    return {
      visitId: visit.id,
      sourceVisitKey: visit.sourceVisitKey,
      repairOrder: visit.repairOrder,
      deliveredOn: visit.deliveredOn,
      customerName: [firstName, lastName].filter(Boolean).join(" ") || "Name not given",
      evidence,
      hasCountedResponse: counted.has(visit.id),
    };
  });
}

/**
 * Match a known-shop response to a visit. It becomes the counted result only
 * if the visit has none; otherwise it goes to duplicate review, and a legacy
 * visit keeps it as a reference only (AT-28: counted exactly once).
 */
export async function matchToVisit(tx: Tx, actor: Actor, responseId: string, expectedMatchRevision: number, visitId: string, evidence: string, now = new Date()) {
  const r = await lockResponse(tx, responseId, expectedMatchRevision);
  if (r.matchStatus !== "visit_unmatched") throw new StaffResponseError("conflict", "This response is not waiting for a visit match.");
  const [visit] = await tx
    .select({ id: repairVisit.id, shopId: repairVisit.shopId, isTest: repairVisit.isTest, invitationId: invitation.id })
    .from(repairVisit)
    .leftJoin(invitation, eq(invitation.visitId, repairVisit.id))
    .where(eq(repairVisit.id, visitId));
  if (!visit || visit.shopId !== r.shopId || visit.isTest !== r.isTest) throw new StaffResponseError("invalid", "That visit is not at this response's shop.");

  const placement = await placeForVisit(tx, visitId);
  await tx
    .update(surveyResponse)
    // The visit links the response to its invitation; submitted answer columns stay locked (SR-17).
    .set({ visitId, ...placement, matchRevision: r.matchRevision + 1 })
    .where(eq(surveyResponse.id, responseId));
  await decide(tx, actor, responseId, "visit_matched", { shopId: r.shopId, visitId, evidence });
  if (placement.canonical && visit.invitationId) await cancelAfterSubmission(tx, visit.invitationId, now);
  await recordAudit(
    { ...auditActor(actor), shopId: r.shopId, action: "response.matched", subjectType: "survey_response", subjectId: responseId, after: { visitId, matchStatus: placement.matchStatus, canonical: placement.canonical, evidence } },
    tx,
  );
  return placement;
}

/** PSG looked and could not match yet; the response stays pending and is never erased. */
export async function recordUnresolved(tx: Tx, actor: Actor, responseId: string, expectedMatchRevision: number, note: string) {
  const r = await lockResponse(tx, responseId, expectedMatchRevision);
  if (note.trim().length < 5) throw new StaffResponseError("invalid", "Say what you checked.");
  await tx.update(surveyResponse).set({ matchRevision: r.matchRevision + 1 }).where(eq(surveyResponse.id, responseId));
  await decide(tx, actor, responseId, "unresolved", { shopId: r.shopId, evidence: note });
}

/** Confirm the shop for a response without confirmed shop context. Visit matching follows separately (AT-29). */
export async function confirmShop(tx: Tx, actor: Actor, responseId: string, expectedMatchRevision: number, shopId: string, evidence: string) {
  const r = await lockResponse(tx, responseId, expectedMatchRevision);
  if (r.matchStatus !== "shop_unconfirmed") throw new StaffResponseError("conflict", "This response's shop is already confirmed.");
  if (evidence.trim().length < 5) throw new StaffResponseError("invalid", "Record the evidence for this shop.");
  const [target] = await tx.select({ id: shop.id, archivedAt: shop.archivedAt }).from(shop).where(eq(shop.id, shopId));
  if (!target || target.archivedAt) throw new StaffResponseError("invalid", "Choose a shop.");
  await tx.update(surveyResponse).set({ shopId, matchStatus: "visit_unmatched", matchRevision: r.matchRevision + 1 }).where(eq(surveyResponse.id, responseId));
  await shopConfirmed(tx, responseId, shopId);
  await decide(tx, actor, responseId, "shop_confirmed", { shopId, evidence });
  await recordAudit({ ...auditActor(actor), shopId, action: "response.shop_confirmed", subjectType: "survey_response", subjectId: responseId, after: { shopId, evidence } }, tx);
}

/**
 * Settle a duplicate (SR-19). Keeping the original changes no count.
 * Promoting this one is an explicit audited swap of the counted response for
 * the visit, so aggregates change exactly once (AT-19).
 */
export async function resolveDuplicate(tx: Tx, actor: Actor, responseId: string, expectedMatchRevision: number, disposition: "keep_original" | "promote", note: string) {
  const r = await lockResponse(tx, responseId, expectedMatchRevision);
  if (r.matchStatus !== "duplicate_review" || !r.visitId) throw new StaffResponseError("conflict", "This response is not in duplicate review.");
  if (note.trim().length < 5) throw new StaffResponseError("invalid", "Say why you chose this.");
  const [current] = await tx
    .select()
    .from(surveyResponse)
    .where(and(eq(surveyResponse.visitId, r.visitId), eq(surveyResponse.canonical, true)))
    .for("update");

  if (disposition === "keep_original" || !current) {
    await tx.update(surveyResponse).set({ matchStatus: "matched", duplicateDisposition: "kept_original", matchRevision: r.matchRevision + 1 }).where(eq(surveyResponse.id, responseId));
  } else {
    await tx.update(surveyResponse).set({ canonical: false, duplicateDisposition: "promoted_other", matchRevision: current.matchRevision + 1 }).where(eq(surveyResponse.id, current.id));
    await tx.update(surveyResponse).set({ canonical: true, matchStatus: "matched", duplicateDisposition: null, matchRevision: r.matchRevision + 1 }).where(eq(surveyResponse.id, responseId));
  }
  await decide(tx, actor, responseId, disposition === "promote" ? "duplicate_promoted" : "duplicate_kept_original", { shopId: r.shopId, visitId: r.visitId, otherResponseId: current?.id ?? null, evidence: note });
  await recordAudit(
    { ...auditActor(actor), shopId: r.shopId, action: `response.duplicate_${disposition}`, subjectType: "survey_response", subjectId: responseId, after: { visitId: r.visitId, previousCounted: current?.id ?? null, note } },
    tx,
  );
}

// ---------------------------------------------------------------------------
// Corrections (SR-20)
// ---------------------------------------------------------------------------

/**
 * Append a corrected revision. The original and every earlier revision stay;
 * outcomes are recomputed with the pinned rules, and a changed alert outcome
 * is flagged for explicit review (AT-20).
 */
export async function correctResponse(tx: Tx, actor: Actor, responseId: string, expectedRevision: number, answers: unknown, reason: string, now = new Date()) {
  if (reason.trim().length < 5) throw new StaffResponseError("invalid", "Give the reason for the correction.");
  const [r] = await tx.select().from(surveyResponse).where(eq(surveyResponse.id, responseId)).for("update");
  if (!r || r.status !== "submitted") throw new StaffResponseError("not_found", "This response no longer exists.");
  const [latest] = await tx.select().from(responseRevision).where(eq(responseRevision.responseId, responseId)).orderBy(desc(responseRevision.revision)).limit(1);
  if (latest.revision !== expectedRevision) throw new StaffResponseError("conflict", "Someone else corrected this response. Reload to see the latest answers.");

  const { definition, hash } = await loadVersion(tx, r.instrumentVersionId, r.additionVersionId);
  const evaluated = evaluateSubmission(definition, answers);
  if (!evaluated.ok) throw new StaffResponseError("invalid", "Some answers need attention.", evaluated.errors);
  if (definitionHash(evaluated.answers) === definitionHash(latest.answers)) throw new StaffResponseError("invalid", "Nothing changed.");

  const before = latest.outcomes as Outcomes;
  await tx.insert(responseRevision).values({
    responseId,
    revision: latest.revision + 1,
    answers: evaluated.answers,
    outcomes: evaluated.outcomes,
    definitionHash: hash,
    evaluatorVersion: evaluated.outcomes.evaluatorVersion,
    ...auditActor(actor),
    reason: reason.trim(),
    createdAt: now,
  });
  // Changed alert or suppression outcomes go back to PSG review explicitly (AT-20).
  const { alertsChanged, suppressionsChanged } = await raiseForCorrection(tx, responseId, before, evaluated.outcomes, latest.revision + 1, now);
  await recordAudit(
    {
      ...auditActor(actor),
      shopId: r.shopId,
      action: "response.corrected",
      subjectType: "survey_response",
      subjectId: responseId,
      before: { revision: latest.revision, answers: latest.answers, alerts: before.alerts.map((a) => a.id) },
      after: { revision: latest.revision + 1, answers: evaluated.answers, alerts: evaluated.outcomes.alerts.map((a) => a.id), alertsChanged, suppressionsChanged, reason: reason.trim() },
    },
    tx,
  );
  return { revision: latest.revision + 1, alertsChanged, suppressionsChanged };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type MatchStatus = (typeof surveyResponse.$inferSelect)["matchStatus"];

type ResponseFilters = { shopId?: string; matchStatus?: MatchStatus; source?: "online" | "paper" | "public" };

const responsesWhere = (filters: ResponseFilters) =>
  and(
    eq(surveyResponse.status, "submitted"),
    filters.shopId ? eq(surveyResponse.shopId, filters.shopId) : undefined,
    filters.matchStatus ? eq(surveyResponse.matchStatus, filters.matchStatus) : undefined,
    filters.source ? eq(surveyResponse.source, filters.source) : undefined,
  );

export async function countResponses(tx: Tx, filters: ResponseFilters) {
  const [row] = await tx.select({ n: count() }).from(surveyResponse).where(responsesWhere(filters));
  return row.n;
}

export async function listResponses(tx: Tx, filters: ResponseFilters, offset: number, size: number) {
  return tx
    .select({
      id: surveyResponse.id,
      source: surveyResponse.source,
      submittedAt: surveyResponse.submittedAt,
      receivedOn: surveyResponse.receivedOn,
      isTest: surveyResponse.isTest,
      matchStatus: surveyResponse.matchStatus,
      canonical: surveyResponse.canonical,
      duplicateDisposition: surveyResponse.duplicateDisposition,
      shopName: shop.name,
      sourceVisitKey: repairVisit.sourceVisitKey,
      context: surveyResponse.respondentContext,
      suggestions: sql<number>`(SELECT count(*)::int FROM shop_suggestion s WHERE s.response_id = ${surveyResponse.id})`,
    })
    .from(surveyResponse)
    .leftJoin(shop, eq(shop.id, surveyResponse.shopId))
    .leftJoin(repairVisit, eq(repairVisit.id, surveyResponse.visitId))
    .where(responsesWhere(filters))
    .orderBy(desc(surveyResponse.submittedAt), desc(surveyResponse.id))
    .limit(size)
    .offset(offset);
}

export async function countByMatchStatus(tx: Tx) {
  const rows = await tx
    .select({ status: surveyResponse.matchStatus, n: sql<number>`count(*)::int` })
    .from(surveyResponse)
    .where(and(eq(surveyResponse.status, "submitted"), ne(surveyResponse.matchStatus, "matched")))
    .groupBy(surveyResponse.matchStatus);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<MatchStatus, number>>;
}

export interface FullResponse {
  response: typeof surveyResponse.$inferSelect;
  shopName: string | null;
  enteredByName: string | null;
  visit: { id: string; sourceVisitKey: string; repairOrder: string | null; deliveredOn: string | null; customerName: string } | null;
  version: { id: string; number: number; isTest: boolean; instrumentId: string };
  /** The shop's own questions this response answered (SR-45); never scored. */
  addition: { number: number; isTest: boolean; questionIds: string[] } | null;
  definition: InstrumentDefinition;
  revisions: { revision: number; answers: Answers; outcomes: Outcomes; reason: string | null; actorName: string | null; actorType: string; createdAt: Date; definitionHash: string; evaluatorVersion: number }[];
  decisions: { kind: string; evidence: string | null; actorName: string | null; createdAt: Date; shopName: string | null }[];
  suggestions: { shopId: string; shopName: string; evidence: string }[];
  counted: { id: string; source: string; submittedAt: Date | null } | null;
}

export async function getFullResponse(tx: Tx, responseId: string): Promise<FullResponse | null> {
  const [row] = await tx
    .select({ response: surveyResponse, shopName: shop.name, enteredByName: user.name, version: instrumentVersion })
    .from(surveyResponse)
    .innerJoin(instrumentVersion, eq(instrumentVersion.id, surveyResponse.instrumentVersionId))
    .leftJoin(shop, eq(shop.id, surveyResponse.shopId))
    .leftJoin(user, eq(user.id, surveyResponse.enteredBy))
    .where(eq(surveyResponse.id, responseId));
  if (!row || row.response.status !== "submitted") return null;
  const survey = await loadSurvey(tx, row.response.instrumentVersionId, row.response.additionVersionId);

  const revisions = await tx
    .select({ rev: responseRevision, actorName: user.name })
    .from(responseRevision)
    .leftJoin(user, eq(user.id, responseRevision.actorUserId))
    .where(eq(responseRevision.responseId, responseId))
    .orderBy(asc(responseRevision.revision));
  const decisions = await tx
    .select({ kind: matchDecision.kind, evidence: matchDecision.evidence, actorName: user.name, createdAt: matchDecision.createdAt, shopName: shop.name })
    .from(matchDecision)
    .leftJoin(user, eq(user.id, matchDecision.actorUserId))
    .leftJoin(shop, eq(shop.id, matchDecision.shopId))
    .where(eq(matchDecision.responseId, responseId))
    .orderBy(asc(matchDecision.id));
  const suggestions = await tx
    .select({ shopId: shopSuggestion.shopId, shopName: shop.name, evidence: shopSuggestion.evidence })
    .from(shopSuggestion)
    .innerJoin(shop, eq(shop.id, shopSuggestion.shopId))
    .where(eq(shopSuggestion.responseId, responseId));

  let visit: FullResponse["visit"] = null;
  let counted: FullResponse["counted"] = null;
  if (row.response.visitId) {
    const [v] = await tx
      .select({ visit: repairVisit, firstName: customer.firstName, lastName: customer.lastName })
      .from(repairVisit)
      .innerJoin(customer, eq(customer.id, repairVisit.customerId))
      .where(eq(repairVisit.id, row.response.visitId));
    if (v) {
      visit = {
        id: v.visit.id,
        sourceVisitKey: v.visit.sourceVisitKey,
        repairOrder: v.visit.repairOrder,
        deliveredOn: v.visit.deliveredOn,
        customerName: [v.firstName, v.lastName].filter(Boolean).join(" ") || "Name not given",
      };
    }
    const [c] = await tx
      .select({ id: surveyResponse.id, source: surveyResponse.source, submittedAt: surveyResponse.submittedAt })
      .from(surveyResponse)
      .where(and(eq(surveyResponse.visitId, row.response.visitId), eq(surveyResponse.canonical, true)));
    counted = c ?? null;
  }

  return {
    response: row.response,
    shopName: row.shopName,
    enteredByName: row.enteredByName,
    visit,
    version: { id: row.version.id, number: row.version.version, isTest: row.version.isTest, instrumentId: row.version.instrumentId },
    addition: survey.addition ? { number: survey.addition.number, isTest: survey.addition.isTest, questionIds: allQuestions(survey.additionDefinition!).map((q) => q.id) } : null,
    definition: survey.definition,
    revisions: revisions.map(({ rev, actorName }) => ({
      revision: rev.revision,
      answers: rev.answers as Answers,
      outcomes: rev.outcomes as Outcomes,
      reason: rev.reason,
      actorName,
      actorType: rev.actorType,
      createdAt: rev.createdAt,
      definitionHash: rev.definitionHash,
      evaluatorVersion: rev.evaluatorVersion,
    })),
    decisions,
    suggestions,
    counted,
  };
}

/** Visits a paper form can be entered against: imported visits at the shop, searched by ID or name. */
export async function searchVisits(tx: Tx, shopId: string, query: string) {
  const q = likeEscape(query.trim());
  if (q.length < 2) return [];
  return tx
    .select({ id: repairVisit.id, sourceVisitKey: repairVisit.sourceVisitKey, deliveredOn: repairVisit.deliveredOn, firstName: customer.firstName, lastName: customer.lastName, isTest: repairVisit.isTest })
    .from(repairVisit)
    .innerJoin(customer, eq(customer.id, repairVisit.customerId))
    .where(and(eq(repairVisit.shopId, shopId), or(ilike(repairVisit.sourceVisitKey, `%${q}%`), ilike(repairVisit.repairOrder, `%${q}%`), ilike(customer.lastName, `%${q}%`))))
    .orderBy(desc(repairVisit.createdAt))
    .limit(20);
}

/** What the paper form for a shop (and optional visit) uses: the visit's pinned version, else the shop's. */
export async function paperFormContext(tx: Tx, shopId: string, visitId: string | null) {
  const ctx = await shopContext(tx, shopId);
  let versionId = ctx.settings.instrumentVersionId;
  let additionVersionId = ctx.settings.additionVersionId;
  let visit: { id: string; sourceVisitKey: string; customerName: string; deliveredOn: string | null; hasCountedResponse: boolean } | null = null;
  if (visitId) {
    const [v] = await tx
      .select({ visit: repairVisit, firstName: customer.firstName, lastName: customer.lastName, versionId: invitation.instrumentVersionId, additionVersionId: invitation.additionVersionId })
      .from(repairVisit)
      .innerJoin(customer, eq(customer.id, repairVisit.customerId))
      .leftJoin(invitation, eq(invitation.visitId, repairVisit.id))
      .where(and(eq(repairVisit.id, visitId), eq(repairVisit.shopId, shopId)));
    if (!v) return null;
    if (v.versionId) [versionId, additionVersionId] = [v.versionId, v.additionVersionId];
    const [counted] = await tx.select({ id: surveyResponse.id }).from(surveyResponse).where(and(eq(surveyResponse.visitId, visitId), eq(surveyResponse.canonical, true)));
    visit = {
      id: v.visit.id,
      sourceVisitKey: v.visit.sourceVisitKey,
      customerName: [v.firstName, v.lastName].filter(Boolean).join(" ") || "Name not given",
      deliveredOn: v.visit.deliveredOn,
      hasCountedResponse: Boolean(counted),
    };
  }
  if (!versionId) return { shop: ctx.shop, visit, version: null };
  const { survey, definition } = await loadVersion(tx, versionId, additionVersionId);
  return { shop: ctx.shop, visit, version: { id: survey.core.id, number: survey.core.number, isTest: survey.core.isTest }, definition };
}
