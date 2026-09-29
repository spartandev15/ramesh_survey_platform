import "server-only";
import { and, desc, eq, or } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { accessToken, instrument, instrumentVersion, invitation, responseRevision, shop, shopSurveySettings, surveyResponse } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { raiseForSubmission } from "@/modules/cases/store";
import { cancelAfterSubmission } from "@/modules/email-ledger/store";
import { placeForVisit } from "./placement";
import { definitionHash } from "@/modules/instruments/canonical";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import { loadSurvey } from "@/modules/instruments/survey";
import { evaluateAnswers, evaluateSubmission, type AnswerError, type Answers, type Outcomes } from "@/modules/instruments/evaluate";
import { generateToken, hashToken } from "./tokens";

/**
 * Invitation, token and response persistence. Functions run inside the
 * caller's transaction and do not authorize: respondent access is the token
 * itself; staff operations authorize in their own module.
 */

export class ResponseConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ResponseConflictError";
  }
}

export type Actor = { type: "user"; userId: string } | { type: "system" };

// ---------------------------------------------------------------------------
// Staff: test invitations
// ---------------------------------------------------------------------------

/**
 * Create a TEST invitation and its access link for internal testing. Test
 * invitations are flagged permanently and can never become live (AT-03).
 * The plaintext token is returned once and never stored.
 */
export async function createTestInvitation(
  tx: Tx,
  actor: Actor,
  input: { shopId: string; instrumentVersionId: string; lifetimeDays: number; now?: Date },
): Promise<{ invitationId: string; token: string; expiresAt: Date }> {
  const [version] = await tx
    .select({ id: instrumentVersion.id, status: instrumentVersion.status, ownerShopId: instrument.shopId })
    .from(instrumentVersion)
    .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
    .where(eq(instrumentVersion.id, input.instrumentVersionId));
  // Invitations pin a published, immutable version (SR-15); drafts can still change.
  if (!version || version.status !== "published") throw new ResponseConflictError("Only published survey versions can be sent");
  const [target] = await tx.select({ id: shop.id, coreVersionId: shopSurveySettings.instrumentVersionId, additionVersionId: shopSurveySettings.additionVersionId }).from(shop).leftJoin(shopSurveySettings, eq(shopSurveySettings.shopId, shop.id)).where(eq(shop.id, input.shopId));
  if (!target) throw new ResponseConflictError("Unknown shop");

  // A shop's questions are tested after that shop's core survey; a core version with the shop's current questions (SR-45).
  let versions: { instrumentVersionId: string; additionVersionId: string | null };
  if (version.ownerShopId) {
    if (version.ownerShopId !== target.id) throw new ResponseConflictError("These questions belong to another shop");
    if (!target.coreVersionId) throw new ResponseConflictError("Assign the shop's core survey version first");
    versions = { instrumentVersionId: target.coreVersionId, additionVersionId: version.id };
  } else {
    versions = { instrumentVersionId: version.id, additionVersionId: target.additionVersionId };
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.lifetimeDays * 24 * 60 * 60 * 1000);
  const token = generateToken();
  const [created] = await tx
    .insert(invitation)
    .values({ shopId: input.shopId, ...versions, isTest: true, createdBy: actor.type === "user" ? actor.userId : null, createdAt: now })
    .returning({ id: invitation.id });
  await tx.insert(accessToken).values({ invitationId: created.id, tokenHash: hashToken(token), issuedAt: now, expiresAt });

  await recordAudit(
    {
      actorType: actor.type,
      actorUserId: actor.type === "user" ? actor.userId : null,
      shopId: input.shopId,
      action: "invitation.test_created",
      subjectType: "invitation",
      subjectId: created.id,
      // Never the token itself (PDF: no secrets in logs or audit).
      after: { ...versions, expiresAt: expiresAt.toISOString(), isTest: true },
    },
    tx,
  );
  return { invitationId: created.id, token, expiresAt };
}

// ---------------------------------------------------------------------------
// Respondent: resolve a token
// ---------------------------------------------------------------------------

export interface SurveyContext {
  invitationId: string;
  /** The imported repair visit; null for PSG test links. */
  visitId: string | null;
  isTest: boolean;
  shop: { id: string; name: string; logoUrl: string | null; brandColor: string | null };
  version: { id: string; definitionHash: string };
  /** The shop's own questions pinned on the invitation, if any (SR-45). */
  additionVersionId: string | null;
  /** Core pages then the shop's pages; scored by the core rules only. */
  definition: InstrumentDefinition;
  expiresAt: Date;
}

export type TokenState =
  | { state: "invalid" }
  | { state: "expired"; context: SurveyContext }
  | { state: "submitted"; context: SurveyContext; submittedAt: Date }
  | { state: "open"; context: SurveyContext; answers: Answers; revision: number; savedAt: Date | null };

interface Resolved {
  context: SurveyContext;
  tokenExpired: boolean;
  response: typeof surveyResponse.$inferSelect | null;
}

async function resolve(tx: Tx, token: string, now: Date, lock: boolean): Promise<Resolved | null> {
  const query = tx
    .select({
      tokenExpiresAt: accessToken.expiresAt,
      revokedAt: accessToken.revokedAt,
      invitationId: invitation.id,
      isTest: invitation.isTest,
      visitId: invitation.visitId,
      shopId: shop.id,
      shopName: shop.name,
      logoUrl: shop.logoUrl,
      brandColor: shop.brandColor,
      versionId: invitation.instrumentVersionId,
      additionVersionId: invitation.additionVersionId,
    })
    .from(accessToken)
    .innerJoin(invitation, eq(invitation.id, accessToken.invitationId))
    .innerJoin(shop, eq(shop.id, invitation.shopId))
    .where(eq(accessToken.tokenHash, hashToken(token)));
  // Lock the invitation so concurrent saves and submits for it serialize.
  const [row] = lock ? await query.for("update", { of: invitation }) : await query;
  if (!row || row.revokedAt) return null;

  const survey = await loadSurvey(tx, row.versionId, row.additionVersionId);

  const [response] = await tx
    .select()
    .from(surveyResponse)
    .where(and(eq(surveyResponse.invitationId, row.invitationId), eq(surveyResponse.source, "online")));

  return {
    context: {
      invitationId: row.invitationId,
      isTest: row.isTest,
      visitId: row.visitId,
      shop: { id: row.shopId, name: row.shopName, logoUrl: row.logoUrl, brandColor: row.brandColor },
      version: { id: row.versionId, definitionHash: survey.core.definitionHash },
      additionVersionId: row.additionVersionId,
      definition: survey.definition,
      expiresAt: row.tokenExpiresAt,
    },
    tokenExpired: row.tokenExpiresAt.getTime() <= now.getTime(),
    response: response ?? null,
  };
}

/**
 * What a token grants right now. A submitted survey stays a locked
 * confirmation even after expiry (AT-21); an expired unanswered one grants
 * no access to its content until renewal (SR-21).
 */
export async function getTokenState(tx: Tx, token: string, now = new Date()): Promise<TokenState> {
  const resolved = await resolve(tx, token, now, false);
  if (!resolved) return { state: "invalid" };
  const { context, response } = resolved;
  if (response?.status === "submitted") return { state: "submitted", context, submittedAt: response.submittedAt! };
  if (resolved.tokenExpired) return { state: "expired", context };
  return {
    state: "open",
    context,
    answers: (response?.draftAnswers as Answers | undefined) ?? {},
    revision: response?.draftRevision ?? 0,
    savedAt: response?.draftSavedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Respondent: autosave and submit
// ---------------------------------------------------------------------------

export type SaveResult =
  | { ok: true; revision: number; savedAt: Date; errors: AnswerError[] }
  | { ok: false; reason: "invalid" | "expired" | "submitted" | "stale"; errors?: AnswerError[] };

/**
 * Save draft answers (SR-16). Only valid answers are stored; drafts never
 * score. `expectedRevision` must match the stored revision, so an older tab
 * cannot overwrite newer answers (AT-16).
 */
export async function saveDraft(tx: Tx, token: string, expectedRevision: number, input: unknown, now = new Date()): Promise<SaveResult> {
  const resolved = await resolve(tx, token, now, true);
  if (!resolved) return { ok: false, reason: "invalid" };
  const { context, response } = resolved;
  if (response?.status === "submitted") return { ok: false, reason: "submitted" };
  if (resolved.tokenExpired) return { ok: false, reason: "expired" };
  if ((response?.draftRevision ?? 0) !== expectedRevision) return { ok: false, reason: "stale" };

  const evaluated = evaluateAnswers(context.definition, input, "draft");
  // Unknown questions or wrong types are rejected outright rather than silently dropped.
  if (evaluated.errors.length > 0) return { ok: false, reason: "invalid", errors: evaluated.errors };

  const revision = expectedRevision + 1;
  if (response) {
    await tx
      .update(surveyResponse)
      .set({ draftAnswers: evaluated.answers, draftRevision: revision, draftSavedAt: now })
      .where(eq(surveyResponse.id, response.id));
  } else {
    await tx.insert(surveyResponse).values({
      invitationId: context.invitationId,
      shopId: context.shop.id,
      instrumentVersionId: context.version.id,
      additionVersionId: context.additionVersionId,
      source: "online",
      isTest: context.isTest,
      draftAnswers: evaluated.answers,
      draftRevision: revision,
      draftSavedAt: now,
    });
  }
  return { ok: true, revision, savedAt: now, errors: [] };
}

export type SubmitResult =
  | { ok: true; responseId: string; submittedAt: Date; outcomes: Outcomes; replayed: boolean }
  | { ok: false; reason: "invalid" | "expired" | "already_submitted"; errors?: AnswerError[] };

/**
 * Submit once (SR-17), in one transaction (PDF 04, transaction 3): lock the
 * invitation, validate against the pinned version, compute outcomes on the
 * server, store the immutable first revision, lock the response and audit.
 *
 * A retry with the same key and answers, or an identical resubmission,
 * returns the original result. Different answers after submission are rejected.
 */
export async function submitResponse(tx: Tx, token: string, requestKey: string, input: unknown, now = new Date()): Promise<SubmitResult> {
  const resolved = await resolve(tx, token, now, true);
  if (!resolved) return { ok: false, reason: "invalid" };
  const { context, response } = resolved;

  const evaluated = evaluateSubmission(context.definition, input);
  const payloadHash = evaluated.ok ? definitionHash(evaluated.answers) : null;

  if (response?.status === "submitted") {
    // Identical answers replay the original result, whatever the key. Different answers
    // are refused, including under the original key (PDF 05: same key, different body = 409).
    const sameAnswers = payloadHash !== null && payloadHash === response.submitPayloadHash;
    if (!sameAnswers) return { ok: false, reason: "already_submitted" };
    const [original] = await tx.select().from(responseRevision).where(and(eq(responseRevision.responseId, response.id), eq(responseRevision.revision, 1)));
    return { ok: true, responseId: response.id, submittedAt: response.submittedAt!, outcomes: original.outcomes as Outcomes, replayed: true };
  }
  if (resolved.tokenExpired) return { ok: false, reason: "expired" };
  if (!evaluated.ok) return { ok: false, reason: "invalid", errors: evaluated.errors };

  // First committed submission for the visit is the counted one (SR-19).
  const placement = await placeForVisit(tx, context.visitId);
  let responseId = response?.id;
  if (!responseId) {
    const [created] = await tx
      .insert(surveyResponse)
      .values({ invitationId: context.invitationId, shopId: context.shop.id, instrumentVersionId: context.version.id, additionVersionId: context.additionVersionId, source: "online", isTest: context.isTest })
      .returning({ id: surveyResponse.id });
    responseId = created.id;
  }

  await tx.insert(responseRevision).values({
    responseId,
    revision: 1,
    answers: evaluated.answers,
    outcomes: evaluated.outcomes,
    definitionHash: context.version.definitionHash,
    evaluatorVersion: evaluated.outcomes.evaluatorVersion,
    actorType: "respondent",
  });
  await tx
    .update(surveyResponse)
    .set({ status: "submitted", submittedAt: now, submitRequestKey: requestKey, submitPayloadHash: payloadHash, draftAnswers: evaluated.answers, visitId: context.visitId, ...placement })
    .where(eq(surveyResponse.id, responseId));
  // No reminder or renewal after a submission (SR-24, AT-24).
  await cancelAfterSubmission(tx, context.invitationId, now);
  // Negative feedback and suppression work are queued in the same transaction (PDF 04, boundary 3).
  await raiseForSubmission(tx, responseId, now);

  await recordAudit(
    {
      actorType: "respondent",
      shopId: context.shop.id,
      action: "response.submitted",
      subjectType: "survey_response",
      subjectId: responseId,
      after: {
        invitationId: context.invitationId,
        instrumentVersionId: context.version.id,
        isTest: context.isTest,
        alerts: evaluated.outcomes.alerts.map((a) => a.id),
        droppedHidden: evaluated.droppedHidden,
      },
    },
    tx,
  );
  return { ok: true, responseId, submittedAt: now, outcomes: evaluated.outcomes, replayed: false };
}

// ---------------------------------------------------------------------------
// Staff: test invitation list for a version
// ---------------------------------------------------------------------------

export interface TestInvitationRow {
  invitationId: string;
  responseId: string | null;
  shopName: string;
  createdAt: Date;
  expiresAt: Date;
  expired: boolean;
  status: "not_started" | "draft" | "submitted";
  submittedAt: Date | null;
  alerts: string[];
  metrics: Record<string, number | null> | null;
}

export async function listTestInvitations(tx: Tx, instrumentVersionId: string, limit = 50, now = new Date()): Promise<TestInvitationRow[]> {
  const rows = await tx
    .select({
      invitationId: invitation.id,
      responseId: surveyResponse.id,
      shopName: shop.name,
      createdAt: invitation.createdAt,
      expiresAt: accessToken.expiresAt,
      status: surveyResponse.status,
      submittedAt: surveyResponse.submittedAt,
      outcomes: responseRevision.outcomes,
    })
    .from(invitation)
    .innerJoin(shop, eq(shop.id, invitation.shopId))
    .innerJoin(accessToken, eq(accessToken.invitationId, invitation.id))
    .leftJoin(surveyResponse, and(eq(surveyResponse.invitationId, invitation.id), eq(surveyResponse.source, "online")))
    .leftJoin(responseRevision, and(eq(responseRevision.responseId, surveyResponse.id), eq(responseRevision.revision, 1)))
    // A shop's questions are tested as the addition to its core survey (SR-45).
    .where(and(or(eq(invitation.instrumentVersionId, instrumentVersionId), eq(invitation.additionVersionId, instrumentVersionId)), eq(invitation.isTest, true)))
    .orderBy(desc(invitation.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const outcomes = r.outcomes as Outcomes | null;
    return {
      invitationId: r.invitationId,
      responseId: r.responseId,
      shopName: r.shopName,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      expired: r.expiresAt.getTime() <= now.getTime(),
      status: r.status === "submitted" ? "submitted" : r.status === "draft" ? "draft" : "not_started",
      submittedAt: r.submittedAt,
      alerts: outcomes?.alerts.map((a) => a.label) ?? [],
      metrics: outcomes?.metrics ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Staff: one submitted response with its provenance
// ---------------------------------------------------------------------------

export interface ResponseDetail {
  responseId: string;
  instrumentId: string;
  isTest: boolean;
  source: "online" | "public" | "paper";
  shopName: string | null;
  submittedAt: Date;
  version: { id: string; number: number; definitionHash: string; isTest: boolean };
  definition: InstrumentDefinition;
  revision: { number: number; answers: Answers; outcomes: Outcomes; definitionHash: string; evaluatorVersion: number; createdAt: Date };
}

/**
 * The current revision of a submitted response and the exact rules that
 * scored it (AT-15). Drafts are never returned: they are not results (SR-16).
 */
export async function getResponseDetail(tx: Tx, responseId: string): Promise<ResponseDetail | null> {
  const [row] = await tx
    .select({
      responseId: surveyResponse.id,
      status: surveyResponse.status,
      isTest: surveyResponse.isTest,
      source: surveyResponse.source,
      submittedAt: surveyResponse.submittedAt,
      shopName: shop.name,
      versionId: instrumentVersion.id,
      instrumentId: instrumentVersion.instrumentId,
      versionNumber: instrumentVersion.version,
      versionHash: instrumentVersion.definitionHash,
      versionIsTest: instrumentVersion.isTest,
      additionVersionId: surveyResponse.additionVersionId,
    })
    .from(surveyResponse)
    .innerJoin(instrumentVersion, eq(instrumentVersion.id, surveyResponse.instrumentVersionId))
    .leftJoin(shop, eq(shop.id, surveyResponse.shopId))
    .where(eq(surveyResponse.id, responseId));
  if (!row || row.status !== "submitted" || !row.submittedAt || !row.versionHash) return null;

  // The designated current revision is the latest one (corrections append, SR-20).
  const [revision] = await tx
    .select()
    .from(responseRevision)
    .where(eq(responseRevision.responseId, responseId))
    .orderBy(desc(responseRevision.revision))
    .limit(1);
  if (!revision) return null;
  const survey = await loadSurvey(tx, row.versionId, row.additionVersionId);

  return {
    responseId: row.responseId,
    instrumentId: row.instrumentId,
    isTest: row.isTest,
    source: row.source,
    shopName: row.shopName,
    submittedAt: row.submittedAt,
    version: { id: row.versionId, number: row.versionNumber, definitionHash: row.versionHash, isTest: row.versionIsTest },
    definition: survey.definition,
    revision: {
      number: revision.revision,
      answers: revision.answers as Answers,
      outcomes: revision.outcomes as Outcomes,
      definitionHash: revision.definitionHash,
      evaluatorVersion: revision.evaluatorVersion,
      createdAt: revision.createdAt,
    },
  };
}
