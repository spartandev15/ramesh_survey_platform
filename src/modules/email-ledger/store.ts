import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  accessToken,
  alertApproval,
  alertCase,
  customer,
  emailEvent,
  emailIntent,
  invitation,
  legacySurveyLedger,
  repairVisit,
  shop,
  shopOptOut,
  shopSurveySettings,
  surveyResponse,
  testRecipientAllowlist,
} from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { sendBlockers } from "@/modules/imports/eligibility";
import { normalizeEmail } from "@/modules/imports/mapping";
import { generateToken, hashToken } from "@/modules/responses/tokens";
import { matchesTestAllowlist, type SendKind } from "@/modules/shops/settings-policy";
import { createOptOutToken } from "./opt-out-token";
import { decideDispatch, LEASE_MS, linkExpiry, MAX_RENEWALS, afterRejection, reminderDueAt, reminderStartsHeld, stateAfterEvent, type StopReason } from "./policy";
import type { ProviderEvent } from "./sendgrid-events";
import { renderAlertEmail, renderEmail } from "./templates";

/**
 * Durable email ledger (SR-22..SR-26). Runs inside the caller's transaction
 * and does NOT authorize. The dispatcher uses three short transactions per
 * email: prepare (claim + final checks + token), provider call outside any
 * transaction, then record the outcome (PDF 04 transaction boundary 2).
 */

export type Actor = { type: "user"; userId: string } | { type: "system" };
export type IntentRow = typeof emailIntent.$inferSelect;

export class LedgerError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

function auditActor(actor: Actor) {
  return actor.type === "user" ? { actorType: "user" as const, actorUserId: actor.userId } : { actorType: "system" as const };
}

export interface LinkConfig {
  appUrl: string;
  optOutSecret: string;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * A worker that stopped mid-send may or may not have reached the provider, so
 * an expired lease becomes acceptance-unknown for reconciliation, never an
 * automatic resend (AT-23).
 */
export async function reclaimExpiredLeases(tx: Tx, now: Date): Promise<number> {
  const rows = await tx
    .update(emailIntent)
    .set({ state: "acceptance_unknown", leaseOwner: null, leaseUntil: null, lastError: "The sender stopped during the provider call; outcome unknown", updatedAt: now })
    .where(and(eq(emailIntent.state, "sending"), sql`${emailIntent.leaseUntil} < ${now}`))
    .returning({ id: emailIntent.id, invitationId: emailIntent.invitationId });
  for (const r of rows) {
    await recordAudit({ actorType: "system", action: "email.acceptance_unknown", subjectType: "email_intent", subjectId: r.id, after: { reason: "lease_expired" } }, tx);
  }
  return rows.length;
}

export type Prepared =
  | { kind: "none" }
  | { kind: "stopped"; intentId: string; state: "held" | "cancelled"; reason: StopReason }
  | { kind: "send"; intentId: string; tokenId: string | null; message: { to: string; subject: string; text: string; html: string; correlationId: string } };

/**
 * Claim the next due intent (SKIP LOCKED, so concurrent workers never take
 * the same one) and apply the final checks under a lock on its invitation.
 */
/** `scope` limits the claim to given intents; used by tests so they never touch other data. */
export async function prepareNext(tx: Tx, owner: string, links: LinkConfig, now: Date, scope?: { intentIds: string[] }): Promise<Prepared> {
  const [intent] = await tx
    .select()
    .from(emailIntent)
    .where(and(eq(emailIntent.state, "queued"), sql`${emailIntent.dueAt} <= ${now}`, scope ? inArray(emailIntent.id, scope.intentIds) : undefined))
    .orderBy(asc(emailIntent.dueAt))
    .limit(1)
    .for("update", { skipLocked: true });
  if (!intent) return { kind: "none" };
  if (intent.alertApprovalId) return prepareAlert(tx, intent, intent.alertApprovalId, owner, links, now);
  const invitationId = intent.invitationId!;
  const kind = intent.kind as SendKind;

  const [ctx] = await tx
    .select({ invitation, settings: shopSurveySettings, shop, visit: repairVisit, customer })
    .from(invitation)
    .innerJoin(shop, eq(shop.id, invitation.shopId))
    .innerJoin(shopSurveySettings, eq(shopSurveySettings.shopId, invitation.shopId))
    .leftJoin(repairVisit, eq(repairVisit.id, invitation.visitId))
    .leftJoin(customer, eq(customer.id, repairVisit.customerId))
    .where(eq(invitation.id, invitationId))
    .for("update", { of: invitation });

  const stop = async (state: "held" | "cancelled", reason: StopReason): Promise<Prepared> => {
    await tx.update(emailIntent).set({ state, stateReason: reason, updatedAt: now }).where(eq(emailIntent.id, intent.id));
    await recordAudit({ actorType: "system", shopId: ctx?.shop.id ?? null, action: `email.${state}`, subjectType: "email_intent", subjectId: intent.id, after: { reason } }, tx);
    return { kind: "stopped", intentId: intent.id, state, reason };
  };
  if (!ctx?.visit || !ctx.customer) return stop("cancelled", "NOT_IMPORTED");
  // An archived shop never emails anyone again, test sends included.
  if (ctx.shop.archivedAt) return stop("cancelled", "SHOP_ARCHIVED");

  const recipient = normalizeEmail(intent.recipient);
  const [submitted] = await tx
    .select({ id: surveyResponse.id })
    .from(surveyResponse)
    .where(and(eq(surveyResponse.invitationId, invitationId), eq(surveyResponse.status, "submitted")))
    .limit(1);
  const [optedOut] = recipient
    ? await tx.select({ id: shopOptOut.id }).from(shopOptOut).where(and(eq(shopOptOut.shopId, ctx.shop.id), eq(shopOptOut.emailNormalized, recipient)))
    : [];
  const allowlist = (await tx.select({ entry: testRecipientAllowlist.entry }).from(testRecipientAllowlist)).map((a) => a.entry);
  const [ledger] = await tx
    .select({ completedOn: legacySurveyLedger.completedOn })
    .from(legacySurveyLedger)
    .where(and(eq(legacySurveyLedger.shopId, ctx.shop.id), eq(legacySurveyLedger.sourceSystem, ctx.visit.sourceSystem), eq(legacySurveyLedger.sourceVisitKey, ctx.visit.sourceVisitKey)));
  const [initial] = await tx
    .select({ state: emailIntent.state })
    .from(emailIntent)
    .where(and(eq(emailIntent.invitationId, invitationId), eq(emailIntent.kind, "initial")));
  const [latestToken] = await tx
    .select({ expiresAt: accessToken.expiresAt })
    .from(accessToken)
    .where(and(eq(accessToken.invitationId, invitationId), isNull(accessToken.revokedAt)))
    .orderBy(desc(accessToken.expiresAt))
    .limit(1);

  const allowlisted = recipient ? matchesTestAllowlist(recipient, allowlist) : false;
  const shopFacts = { mode: ctx.settings.mode, deliveryCutoff: ctx.settings.deliveryCutoff, legacyCoverageConfirmed: ctx.settings.legacyCoverageConfirmedAt !== null };
  const decision = decideDispatch({
    kind,
    mode: ctx.settings.mode,
    isTest: intent.isTest,
    recipientAllowlisted: allowlisted,
    optedOut: Boolean(optedOut),
    submitted: Boolean(submitted),
    blockers: sendBlockers(
      {
        isTest: intent.isTest,
        emailNormalized: recipient,
        deliveredOn: ctx.visit.deliveredOn,
        legacy: ledger ? { invited: true, completed: ledger.completedOn !== null } : null,
        optedOut: Boolean(optedOut),
        recipientAllowlisted: allowlisted,
      },
      shopFacts,
    ),
    initialAccepted: initial?.state === "accepted" || initial?.state === "delivered",
    linkOpen: latestToken ? latestToken.expiresAt.getTime() > now.getTime() : false,
  });
  if (decision.action !== "send") return stop(decision.action === "hold" ? "held" : "cancelled", decision.reason);
  if (!recipient) return stop("cancelled", "EMAIL_NEEDED");

  // Renewal replaces every earlier link atomically (proposal P-03); drafts stay on the invitation.
  if (intent.kind === "renewal") {
    await tx.update(accessToken).set({ revokedAt: now }).where(and(eq(accessToken.invitationId, invitationId), isNull(accessToken.revokedAt)));
  }
  const token = generateToken();
  const expiresAt = linkExpiry(kind, now, ctx.settings.linkLifetimeDays, latestToken?.expiresAt ?? null);
  const [issued] = await tx.insert(accessToken).values({ invitationId: invitationId, tokenHash: hashToken(token), issuedAt: now, expiresAt }).returning({ id: accessToken.id });

  // Persist the attempt before the provider call (PDF 04).
  await tx
    .update(emailIntent)
    .set({ state: "sending", leaseOwner: owner, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: intent.attempts + 1, lastAttemptAt: now, stateReason: null, updatedAt: now })
    .where(eq(emailIntent.id, intent.id));

  const base = links.appUrl.replace(/\/$/, "");
  const email = renderEmail({
    kind,
    isTest: intent.isTest,
    shopName: ctx.shop.name,
    brandColor: ctx.shop.brandColor,
    firstName: ctx.customer.firstName,
    surveyUrl: `${base}/survey/${token}`,
    optOutUrl: `${base}/survey/opt-out/${createOptOutToken(links.optOutSecret, invitationId)}`,
    expiresAt,
    timezone: ctx.shop.timezone,
  });
  return { kind: "send", intentId: intent.id, tokenId: issued.id, message: { to: recipient, ...email, correlationId: intent.id } };
}

/** The shop an email belongs to, through its invitation or its alert. */
async function intentShopId(tx: Tx, intent: IntentRow): Promise<string | null> {
  if (intent.invitationId) {
    const [inv] = await tx.select({ shopId: invitation.shopId }).from(invitation).where(eq(invitation.id, intent.invitationId));
    return inv?.shopId ?? null;
  }
  if (intent.alertApprovalId) {
    const [row] = await tx.select({ shopId: alertCase.shopId }).from(alertApproval).innerJoin(alertCase, eq(alertCase.id, alertApproval.caseId)).where(eq(alertApproval.id, intent.alertApprovalId));
    return row?.shopId ?? null;
  }
  return null;
}

/**
 * Final check for a shop alert email (SR-33). The case must still be
 * approved; test cases reach only allowlisted internal addresses (AT-03).
 * Alerts go to the shop's own staff, so a paused shop still receives them
 * (proposal: pausing stops customer outreach, not PSG-to-shop notices).
 */
async function prepareAlert(tx: Tx, intent: IntentRow, approvalId: string, owner: string, links: LinkConfig, now: Date): Promise<Prepared> {
  const [ctx] = await tx
    .select({ approval: alertApproval, case: alertCase, shopName: shop.name, brandColor: shop.brandColor, archivedAt: shop.archivedAt })
    .from(alertApproval)
    .innerJoin(alertCase, eq(alertCase.id, alertApproval.caseId))
    .innerJoin(shop, eq(shop.id, alertCase.shopId))
    .where(eq(alertApproval.id, approvalId))
    .for("update", { of: alertCase });
  const stop = async (reason: string): Promise<Prepared> => {
    await tx.update(emailIntent).set({ state: "cancelled", stateReason: reason, updatedAt: now }).where(eq(emailIntent.id, intent.id));
    await recordAudit({ actorType: "system", shopId: ctx?.case.shopId ?? null, action: "email.cancelled", subjectType: "email_intent", subjectId: intent.id, after: { reason } }, tx);
    return { kind: "stopped", intentId: intent.id, state: "cancelled", reason: reason as StopReason };
  };
  if (!ctx || ctx.case.status !== "approved") return stop("ALERT_NOT_APPROVED");
  if (ctx.archivedAt) return stop("SHOP_ARCHIVED");
  const recipient = normalizeEmail(intent.recipient);
  if (!recipient) return stop("EMAIL_NEEDED");
  if (intent.isTest) {
    const allowlist = (await tx.select({ entry: testRecipientAllowlist.entry }).from(testRecipientAllowlist)).map((a) => a.entry);
    if (!matchesTestAllowlist(recipient, allowlist)) return stop("TEST_RECIPIENT_NOT_ALLOWED");
  }

  await tx
    .update(emailIntent)
    .set({ state: "sending", leaseOwner: owner, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: intent.attempts + 1, lastAttemptAt: now, stateReason: null, updatedAt: now })
    .where(eq(emailIntent.id, intent.id));
  const email = renderAlertEmail({
    isTest: intent.isTest,
    shopName: ctx.shopName,
    brandColor: ctx.brandColor,
    alerts: (ctx.case.alerts as { label: string }[]).map((a) => a.label),
    // A link to the authorized Hub page, not the customer's details (PDF 04).
    detailUrl: `${links.appUrl.replace(/\/$/, "")}/shop/${ctx.case.shopId}/responses/${ctx.case.responseId}`,
  });
  return { kind: "send", intentId: intent.id, tokenId: null, message: { to: recipient, ...email, correlationId: intent.id } };
}

export type ProviderOutcome = { result: "accepted"; providerMessageId: string | null } | { result: "rejected"; error: string } | { result: "unknown"; error: string };

/** Record what the provider said. Only the worker holding the lease may record a normal outcome. */
export async function recordOutcome(tx: Tx, intentId: string, tokenId: string | null, owner: string, outcome: ProviderOutcome, now: Date) {
  const [intent] = await tx.select().from(emailIntent).where(eq(emailIntent.id, intentId)).for("update");
  if (!intent) return;
  const ours = intent.state === "sending" && intent.leaseOwner === owner;
  // A lease reclaimed as unknown can still be settled by a definite acceptance.
  if (!ours && !(intent.state === "acceptance_unknown" && outcome.result === "accepted")) return;

  const common = { leaseOwner: null, leaseUntil: null, updatedAt: now };
  if (outcome.result === "accepted") {
    await tx.update(emailIntent).set({ ...common, state: "accepted", acceptedAt: now, providerMessageId: outcome.providerMessageId, lastError: null }).where(eq(emailIntent.id, intentId));
  } else if (outcome.result === "unknown") {
    await tx.update(emailIntent).set({ ...common, state: "acceptance_unknown", lastError: outcome.error.slice(0, 500) }).where(eq(emailIntent.id, intentId));
  } else {
    // Definitely not sent: the link in it was never delivered.
    if (tokenId) await tx.update(accessToken).set({ revokedAt: now }).where(eq(accessToken.id, tokenId));
    const next = afterRejection(intent.attempts, now);
    await tx
      .update(emailIntent)
      .set({ ...common, state: next.state, dueAt: next.state === "queued" ? next.dueAt : intent.dueAt, lastError: outcome.error.slice(0, 500) })
      .where(eq(emailIntent.id, intentId));
  }
  // The provider's error stays in history even after a retry clears it from the intent (AT-38).
  const error = outcome.result === "accepted" ? undefined : outcome.error.slice(0, 500);
  await recordAudit({ actorType: "system", shopId: await intentShopId(tx, intent), action: `email.${outcome.result}`, subjectType: "email_intent", subjectId: intentId, after: { kind: intent.kind, attempt: intent.attempts, error } }, tx);
}

// ---------------------------------------------------------------------------
// Reminders (SR-24)
// ---------------------------------------------------------------------------

/**
 * Create the one reminder for each invitation whose delay has passed. The
 * unique index makes this safe to run repeatedly and concurrently: a second
 * reminder can never exist, whatever reimports, renewals or setting changes.
 */
export async function scheduleReminders(tx: Tx, now: Date, limit = 500): Promise<number> {
  const candidates = await tx
    .select({
      invitationId: invitation.id,
      isTest: invitation.isTest,
      acceptedAt: emailIntent.acceptedAt,
      delayDays: shopSurveySettings.reminderDelayDays,
      mode: shopSurveySettings.mode,
      liveSince: shopSurveySettings.liveSince,
      email: customer.emailNormalized,
    })
    .from(emailIntent)
    .innerJoin(invitation, eq(invitation.id, emailIntent.invitationId))
    .innerJoin(shopSurveySettings, eq(shopSurveySettings.shopId, invitation.shopId))
    .innerJoin(repairVisit, eq(repairVisit.id, invitation.visitId))
    .innerJoin(customer, eq(customer.id, repairVisit.customerId))
    .where(
      and(
        eq(emailIntent.kind, "initial"),
        inArray(emailIntent.state, ["accepted", "delivered"]),
        sql`${emailIntent.acceptedAt} + make_interval(days => ${shopSurveySettings.reminderDelayDays}) <= ${now}`,
        // Live shops, plus test records in Test mode so the flow can be tested end to end.
        sql`(${shopSurveySettings.mode} = 'live' OR (${shopSurveySettings.mode} = 'test' AND ${invitation.isTest}))`,
        sql`NOT EXISTS (SELECT 1 FROM email_intent r WHERE r.invitation_id = ${invitation.id} AND r.kind = 'reminder')`,
        sql`NOT EXISTS (SELECT 1 FROM survey_response s WHERE s.invitation_id = ${invitation.id} AND s.status = 'submitted')`,
      ),
    )
    .limit(limit);

  let created = 0;
  for (const c of candidates) {
    if (!c.email || !c.acceptedAt) continue;
    const dueAt = reminderDueAt(c.acceptedAt, c.delayDays);
    const held = c.mode === "live" && !c.isTest && reminderStartsHeld(dueAt, c.liveSince);
    const [row] = await tx
      .insert(emailIntent)
      .values({
        invitationId: c.invitationId,
        kind: "reminder",
        idempotencyKey: `invitation:${c.invitationId}:reminder`,
        recipient: c.email,
        isTest: c.isTest,
        state: held ? "held" : "queued",
        stateReason: held ? "OVERDUE_AFTER_PAUSE" : null,
        dueAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: emailIntent.id });
    if (row) created++;
  }
  return created;
}

/** A submitted survey needs no reminder or renewal (SR-24). Called in the submit transaction. */
export async function cancelAfterSubmission(tx: Tx, invitationId: string, now: Date) {
  await tx
    .update(emailIntent)
    .set({ state: "cancelled", stateReason: "SUBMITTED", updatedAt: now })
    .where(and(eq(emailIntent.invitationId, invitationId), inArray(emailIntent.state, ["queued", "held"]), inArray(emailIntent.kind, ["reminder", "renewal"])));
}

// ---------------------------------------------------------------------------
// Opt-out (SR-25) and renewal (SR-22)
// ---------------------------------------------------------------------------

export async function optOutContext(tx: Tx, invitationId: string) {
  const [row] = await tx
    .select({ shopId: shop.id, shopName: shop.name, logoUrl: shop.logoUrl, brandColor: shop.brandColor, email: customer.emailNormalized })
    .from(invitation)
    .innerJoin(shop, eq(shop.id, invitation.shopId))
    .leftJoin(repairVisit, eq(repairVisit.id, invitation.visitId))
    .leftJoin(customer, eq(customer.id, repairVisit.customerId))
    .where(eq(invitation.id, invitationId));
  return row ?? null;
}

/**
 * Opt this recipient out of survey email from this shop only, and cancel
 * anything still waiting to send to them there. Idempotent.
 */
export async function recordOptOut(tx: Tx, actor: Actor | { type: "respondent" }, invitationId: string, source: string, now: Date) {
  const ctx = await optOutContext(tx, invitationId);
  if (!ctx?.email) return { recorded: false };
  const [created] = await tx.insert(shopOptOut).values({ shopId: ctx.shopId, emailNormalized: ctx.email, source, createdAt: now }).onConflictDoNothing().returning({ id: shopOptOut.id });
  const cancelled = await tx
    .update(emailIntent)
    .set({ state: "cancelled", stateReason: "SHOP_OPT_OUT", updatedAt: now })
    .where(
      and(
        inArray(emailIntent.state, ["queued", "held"]),
        eq(emailIntent.recipient, ctx.email),
        inArray(emailIntent.invitationId, tx.select({ id: invitation.id }).from(invitation).where(eq(invitation.shopId, ctx.shopId))),
      ),
    )
    .returning({ id: emailIntent.id });
  if (created) {
    await recordAudit(
      {
        ...(actor.type === "respondent" ? { actorType: "respondent" as const } : auditActor(actor)),
        shopId: ctx.shopId,
        action: "opt_out.recorded",
        subjectType: "shop_opt_out",
        subjectId: created.id,
        after: { source, invitationId, cancelledIntents: cancelled.length },
      },
      tx,
    );
  }
  return { recorded: true };
}

/**
 * Queue a new link to the address already on record (SR-22). The requester
 * never supplies or sees an address, and the answer is the same whether or
 * not an email will go out (PDF 03). Renewal never adds a reminder (AT-22).
 */
export async function requestRenewal(tx: Tx, token: string, now: Date): Promise<void> {
  const [row] = await tx
    .select({ invitationId: invitation.id, isTest: invitation.isTest, shopId: invitation.shopId, expiresAt: accessToken.expiresAt, revokedAt: accessToken.revokedAt, email: customer.emailNormalized })
    .from(accessToken)
    .innerJoin(invitation, eq(invitation.id, accessToken.invitationId))
    .leftJoin(repairVisit, eq(repairVisit.id, invitation.visitId))
    .leftJoin(customer, eq(customer.id, repairVisit.customerId))
    .where(eq(accessToken.tokenHash, hashToken(token)))
    .for("update", { of: invitation });
  if (!row || row.revokedAt || row.expiresAt.getTime() > now.getTime() || !row.email) return;

  const [submitted] = await tx.select({ id: surveyResponse.id }).from(surveyResponse).where(and(eq(surveyResponse.invitationId, row.invitationId), eq(surveyResponse.status, "submitted")));
  if (submitted) return;
  const [opted] = await tx.select({ id: shopOptOut.id }).from(shopOptOut).where(and(eq(shopOptOut.shopId, row.shopId), eq(shopOptOut.emailNormalized, row.email)));
  if (opted) return;
  const [{ n }] = await tx.select({ n: count() }).from(emailIntent).where(and(eq(emailIntent.invitationId, row.invitationId), eq(emailIntent.kind, "renewal")));
  if (n >= MAX_RENEWALS) return;
  // One pending renewal at a time; repeated clicks do not queue more.
  const [pending] = await tx
    .select({ id: emailIntent.id })
    .from(emailIntent)
    .where(and(eq(emailIntent.invitationId, row.invitationId), eq(emailIntent.kind, "renewal"), inArray(emailIntent.state, ["queued", "sending", "held"])));
  if (pending) return;

  const [created] = await tx
    .insert(emailIntent)
    .values({ invitationId: row.invitationId, kind: "renewal", idempotencyKey: `invitation:${row.invitationId}:renewal:${n + 1}`, recipient: row.email, isTest: row.isTest, createdAt: now, updatedAt: now, dueAt: now })
    .onConflictDoNothing()
    .returning({ id: emailIntent.id });
  if (created) {
    await recordAudit({ actorType: "respondent", shopId: row.shopId, action: "email.renewal_requested", subjectType: "email_intent", subjectId: created.id, after: { invitationId: row.invitationId } }, tx);
  }
}

// ---------------------------------------------------------------------------
// Provider events and PSG reconciliation (SR-23)
// ---------------------------------------------------------------------------

/** Apply verified provider events once each; replays and late events change nothing. */
export async function applyProviderEvents(tx: Tx, provider: string, events: ProviderEvent[]): Promise<{ applied: number; duplicates: number }> {
  let applied = 0;
  let duplicates = 0;
  for (const e of events) {
    const [intent] = e.intentId
      ? await tx.select().from(emailIntent).where(eq(emailIntent.id, e.intentId)).for("update")
      : e.providerMessageId
        ? await tx.select().from(emailIntent).where(eq(emailIntent.providerMessageId, e.providerMessageId)).for("update")
        : [];
    const [stored] = await tx
      .insert(emailEvent)
      .values({ emailIntentId: intent?.id ?? null, provider, providerEventId: e.providerEventId, eventType: e.eventType, occurredAt: e.occurredAt, detail: e.detail })
      .onConflictDoNothing()
      .returning({ id: emailEvent.id });
    if (!stored) {
      duplicates++;
      continue;
    }
    applied++;
    if (!intent) continue;
    const next = stateAfterEvent(intent.state, e.eventType);
    if (!next) continue;
    await tx
      .update(emailIntent)
      .set({
        state: next as IntentRow["state"],
        // Provider evidence settles an unknown attempt; its time is the reminder origin.
        acceptedAt: intent.acceptedAt ?? (next === "accepted" || next === "delivered" ? e.occurredAt : null),
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(emailIntent.id, intent.id));
  }
  return { applied, duplicates };
}

export interface ProblemRow {
  id: string;
  kind: string;
  state: string;
  stateReason: string | null;
  lastError: string | null;
  attempts: number;
  isTest: boolean;
  lastAttemptAt: Date | null;
  dueAt: Date;
  updatedAt: Date;
  shopId: string;
  shopName: string;
  sourceVisitKey: string | null;
  events: number;
}

/** Intents that need a PSG decision: held, unknown outcome, failed or bounced. */
const PROBLEM_STATES = ["held", "acceptance_unknown", "failed", "bounced"] as const;

/** Emails that need a person, with the shop they belong to (survey emails via the invitation, alert emails via their case). */
export async function countProblems(tx: Tx) {
  const [row] = await tx
    .select({ n: count() })
    .from(emailIntent)
    .leftJoin(invitation, eq(invitation.id, emailIntent.invitationId))
    .leftJoin(alertApproval, eq(alertApproval.id, emailIntent.alertApprovalId))
    .leftJoin(alertCase, eq(alertCase.id, alertApproval.caseId))
    .innerJoin(shop, sql`${shop.id} = COALESCE(${invitation.shopId}, ${alertCase.shopId})`)
    .where(inArray(emailIntent.state, [...PROBLEM_STATES]));
  return row.n;
}

export async function listProblems(tx: Tx, offset: number, size: number): Promise<ProblemRow[]> {
  return tx
    .select({
      id: emailIntent.id,
      kind: emailIntent.kind,
      state: emailIntent.state,
      stateReason: emailIntent.stateReason,
      lastError: emailIntent.lastError,
      attempts: emailIntent.attempts,
      isTest: emailIntent.isTest,
      lastAttemptAt: emailIntent.lastAttemptAt,
      dueAt: emailIntent.dueAt,
      updatedAt: emailIntent.updatedAt,
      shopId: shop.id,
      shopName: shop.name,
      sourceVisitKey: repairVisit.sourceVisitKey,
      events: sql<number>`(SELECT count(*)::int FROM email_event e WHERE e.email_intent_id = ${emailIntent.id})`,
    })
    .from(emailIntent)
    // Survey emails reach the shop through the invitation, alert emails through their case.
    .leftJoin(invitation, eq(invitation.id, emailIntent.invitationId))
    .leftJoin(alertApproval, eq(alertApproval.id, emailIntent.alertApprovalId))
    .leftJoin(alertCase, eq(alertCase.id, alertApproval.caseId))
    .innerJoin(shop, sql`${shop.id} = COALESCE(${invitation.shopId}, ${alertCase.shopId})`)
    .leftJoin(repairVisit, eq(repairVisit.id, invitation.visitId))
    .where(inArray(emailIntent.state, [...PROBLEM_STATES]))
    .orderBy(desc(emailIntent.updatedAt), desc(emailIntent.id))
    .limit(size)
    .offset(offset);
}

export type Resolution = "release" | "confirm_sent" | "confirm_not_sent" | "retry";

/**
 * PSG decisions on a problem intent. Each reuses the same intent, so a
 * logical email can never be duplicated by picking a new key (PDF 04).
 * The dispatcher still rechecks everything before sending.
 */
export async function resolveProblem(tx: Tx, actor: Actor, intentId: string, resolution: Resolution, note: string, now: Date) {
  const [intent] = await tx.select().from(emailIntent).where(eq(emailIntent.id, intentId)).for("update");
  if (!intent) throw new LedgerError("not_found", "This email no longer exists.");
  const allowed: Record<Resolution, IntentRow["state"][]> = {
    release: ["held"],
    confirm_sent: ["acceptance_unknown"],
    confirm_not_sent: ["acceptance_unknown"],
    retry: ["failed"],
  };
  if (!allowed[resolution].includes(intent.state)) throw new LedgerError("conflict", "This email changed since you opened the page. Reload and try again.");
  if ((resolution === "confirm_sent" || resolution === "confirm_not_sent") && note.trim().length < 5) {
    throw new LedgerError("invalid", "Describe the provider evidence you checked.");
  }
  const set =
    resolution === "confirm_sent"
      ? { state: "accepted" as const, acceptedAt: intent.lastAttemptAt ?? now }
      : { state: "queued" as const, dueAt: now, stateReason: null, ...(resolution === "retry" ? { attempts: 0 } : {}) };
  await tx.update(emailIntent).set({ ...set, updatedAt: now }).where(eq(emailIntent.id, intentId));
  await recordAudit(
    { ...auditActor(actor), shopId: await intentShopId(tx, intent), action: `email.${resolution}`, subjectType: "email_intent", subjectId: intentId, before: { state: intent.state }, after: { state: set.state, note: note.trim() || null } },
    tx,
  );
}
