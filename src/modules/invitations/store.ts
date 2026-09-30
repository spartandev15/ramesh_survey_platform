import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { inOrder, type Tx } from "@/db/client";
import {
  accessToken,
  customer,
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
import { isExcluded, sendBlockers, WAITING_REASONS, type ReasonCode, type ShopFacts } from "@/modules/imports/eligibility";
import { normalizeEmail } from "@/modules/imports/mapping";
import { generateToken, hashToken } from "@/modules/responses/tokens";
import { isIsoDate, matchesTestAllowlist } from "@/modules/shops/settings-policy";

/**
 * Imported invitations: waiting queue, explicit send and contact corrections
 * (SR-04, SR-09, SR-10, SR-11). Runs inside the caller's transaction and does
 * NOT authorize: call through `invitations.ts`.
 */

export type Actor = { type: "user"; userId: string } | { type: "system" };

export class InvitationError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
    readonly reasons: ReasonCode[] = [],
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

export type QueueView = "ready" | "waiting" | "held" | "excluded" | "sent";

export const QUEUE_LABELS: Record<QueueView, string> = {
  ready: "Ready to send",
  waiting: "Waiting for Live",
  held: "Held",
  excluded: "Excluded",
  sent: "Sent",
};

function auditActor(actor: Actor) {
  return actor.type === "user" ? { actorType: "user" as const, actorUserId: actor.userId } : { actorType: "system" as const };
}

async function shopFacts(tx: Tx, shopId: string, lock = false): Promise<ShopFacts & { linkLifetimeDays: number; name: string }> {
  const query = tx.select({ settings: shopSurveySettings, name: shop.name }).from(shopSurveySettings).innerJoin(shop, eq(shop.id, shopSurveySettings.shopId)).where(eq(shopSurveySettings.shopId, shopId));
  const [row] = lock ? await query.for("share", { of: shopSurveySettings }) : await query;
  if (!row) throw new InvitationError("not_found", "This shop no longer exists.");
  return {
    mode: row.settings.mode,
    deliveryCutoff: row.settings.deliveryCutoff,
    legacyCoverageConfirmed: row.settings.legacyCoverageConfirmedAt !== null,
    linkLifetimeDays: row.settings.linkLifetimeDays,
    name: row.name,
  };
}

const baseColumns = {
  id: invitation.id,
  revision: invitation.revision,
  isTest: invitation.isTest,
  status: invitation.status,
  importReasons: invitation.reasons,
  createdAt: invitation.createdAt,
  visitId: repairVisit.id,
  sourceSystem: repairVisit.sourceSystem,
  sourceVisitKey: repairVisit.sourceVisitKey,
  repairOrder: repairVisit.repairOrder,
  deliveredOn: repairVisit.deliveredOn,
  deliveredOnRaw: repairVisit.deliveredOnRaw,
  customerId: customer.id,
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email,
  emailNormalized: customer.emailNormalized,
};

export interface QueueRow {
  visitId: string;
  id: string;
  revision: number;
  isTest: boolean;
  sourceVisitKey: string;
  repairOrder: string | null;
  deliveredOn: string | null;
  deliveredOnRaw: string | null;
  customerName: string;
  email: string | null;
  createdAt: Date;
  view: QueueView;
  blockers: ReasonCode[];
  intentState: string | null;
  intentReason: string | null;
}

/**
 * Current blockers for a set of imported invitations, from today's facts:
 * settings, legacy ledger, opt-outs, allowlist and existing intents.
 */
async function evaluate(tx: Tx, shopId: string, rows: SelectedRow[], facts: ShopFacts) {
  const keys = [...new Set(rows.map((r) => r.sourceVisitKey))];
  const emails = [...new Set(rows.map((r) => r.emailNormalized).filter((e): e is string => Boolean(e)))];
  const ids = rows.map((r) => r.id);
  const visitIds = [...new Set(rows.map((r) => r.visitId).filter((v): v is string => Boolean(v)))];
  const [ledger, optOuts, allowlist, intents, answers] = await inOrder([
    keys.length
      ? tx
          .select({ system: legacySurveyLedger.sourceSystem, key: legacySurveyLedger.sourceVisitKey, completedOn: legacySurveyLedger.completedOn })
          .from(legacySurveyLedger)
          .where(and(eq(legacySurveyLedger.shopId, shopId), inArray(legacySurveyLedger.sourceVisitKey, keys)))
      : Promise.resolve([]),
    emails.length ? tx.select({ email: shopOptOut.emailNormalized, isTest: shopOptOut.isTest }).from(shopOptOut).where(and(eq(shopOptOut.shopId, shopId), inArray(shopOptOut.emailNormalized, emails))) : Promise.resolve([]),
    tx.select({ entry: testRecipientAllowlist.entry }).from(testRecipientAllowlist),
    ids.length ? tx.select({ invitationId: emailIntent.invitationId, state: emailIntent.state, reason: emailIntent.stateReason }).from(emailIntent).where(and(inArray(emailIntent.invitationId, ids), eq(emailIntent.kind, "initial"))) : Promise.resolve([]),
    // Answered by link, on paper or the public form: nothing more is sent for that visit (SR-24).
    ids.length
      ? tx
          .selectDistinct({ visitId: surveyResponse.visitId, invitationId: surveyResponse.invitationId })
          .from(surveyResponse)
          .where(and(eq(surveyResponse.status, "submitted"), or(inArray(surveyResponse.invitationId, ids), visitIds.length ? inArray(surveyResponse.visitId, visitIds) : sql`false`)))
      : Promise.resolve([]),
  ]);
  const answered = new Set(answers.flatMap((a) => [a.visitId, a.invitationId].filter((v): v is string => Boolean(v))));
  const legacy = new Map(ledger.map((l) => [`${l.system}\u0000${l.key}`, { invited: true, completed: l.completedOn !== null }]));
  // A real opt-out stops every record; one from a test email stops only test records (SR-03).
  const optedReal = new Set(optOuts.filter((o) => !o.isTest).map((o) => o.email));
  const optedAny = new Set(optOuts.map((o) => o.email));
  const entries = allowlist.map((a) => a.entry);
  const intentByInvitation = new Map(intents.map((i) => [i.invitationId, i]));

  return rows.map((r) => {
    const isAnswered = answered.has(r.id) || (r.visitId !== null && answered.has(r.visitId));
    const blockers = sendBlockers(
      {
        isTest: r.isTest,
        emailNormalized: r.emailNormalized,
        deliveredOn: r.deliveredOn,
        legacy: legacy.get(`${r.sourceSystem}\u0000${r.sourceVisitKey}`) ?? null,
        optedOut: r.emailNormalized ? (r.isTest ? optedAny : optedReal).has(r.emailNormalized) : false,
        recipientAllowlisted: r.emailNormalized ? matchesTestAllowlist(r.emailNormalized, entries) : false,
        answered: isAnswered,
      },
      facts,
    );
    const intent = intentByInvitation.get(r.id) ?? null;
    const intentState = intent?.state ?? null;
    // A held email waits for PSG release; a cancelled one will never send (opt-out, submission, legacy).
    const view: QueueView = intent
      ? intent.state === "held"
        ? "held"
        : intent.state === "cancelled"
          ? "excluded"
          : "sent"
      : isExcluded(blockers)
        ? "excluded"
        : blockers.length === 0
          ? "ready"
          : blockers.every((b) => WAITING_REASONS.includes(b))
            ? "waiting"
            : "held";
    return { row: r, blockers: intentState ? (["ALREADY_SENT"] as ReasonCode[]) : blockers, view, intentState, intentReason: intent?.reason ?? null, answered: isAnswered };
  });
}

function selectRows(tx: Tx, where: ReturnType<typeof and>, lock = false) {
  const query = tx
    .select(baseColumns)
    .from(invitation)
    .innerJoin(repairVisit, eq(repairVisit.id, invitation.visitId))
    .innerJoin(customer, eq(customer.id, repairVisit.customerId))
    .where(where)
    .orderBy(desc(invitation.createdAt))
    .limit(2000);
  return lock ? query.for("update", { of: invitation }) : query;
}

type SelectedRow = Awaited<ReturnType<typeof selectRows>>[number];

const customerName = (r: { firstName: string | null; lastName: string | null }) => [r.firstName, r.lastName].filter(Boolean).join(" ") || "Name not given";

/** Imported invitations for one shop, grouped by what PSG can do with them. */
export async function listQueue(tx: Tx, shopId: string): Promise<QueueRow[]> {
  return queueRows(tx, shopId, and(eq(invitation.shopId, shopId), isNotNull(invitation.visitId)));
}

const NO_INITIAL_EMAIL = sql`NOT EXISTS (SELECT 1 FROM email_intent e WHERE e.invitation_id = ${invitation.id} AND e.kind = 'initial')`;

/** Shops with imported invitations that have no invitation email yet: the only ones that can be held (SR-38). */
export async function shopsWithUnsent(tx: Tx, includeTest: boolean): Promise<{ id: string; name: string }[]> {
  return tx
    .selectDistinct({ id: shop.id, name: shop.name })
    .from(invitation)
    .innerJoin(shop, eq(shop.id, invitation.shopId))
    .where(and(isNotNull(invitation.visitId), isNull(shop.archivedAt), NO_INITIAL_EMAIL, includeTest ? undefined : eq(invitation.isTest, false)))
    .orderBy(shop.name);
}

/** One shop's imported invitations that have no invitation email yet, with their current blockers. */
export async function listUnsent(tx: Tx, shopId: string, includeTest: boolean): Promise<QueueRow[]> {
  return queueRows(tx, shopId, and(eq(invitation.shopId, shopId), isNotNull(invitation.visitId), NO_INITIAL_EMAIL, includeTest ? undefined : eq(invitation.isTest, false)));
}

async function queueRows(tx: Tx, shopId: string, where: ReturnType<typeof and>): Promise<QueueRow[]> {
  const facts = await shopFacts(tx, shopId);
  const rows = await selectRows(tx, where);
  const evaluated = await evaluate(tx, shopId, rows, facts);
  return evaluated.map(({ row, blockers, view, intentState, intentReason }) => ({
    id: row.id,
    visitId: row.visitId,
    revision: row.revision,
    isTest: row.isTest,
    sourceVisitKey: row.sourceVisitKey,
    repairOrder: row.repairOrder,
    deliveredOn: row.deliveredOn,
    deliveredOnRaw: row.deliveredOnRaw,
    customerName: customerName(row),
    email: row.email,
    createdAt: row.createdAt,
    view,
    blockers,
    intentState,
    intentReason,
  }));
}

export type SendResult = { id: string; ok: true } | { id: string; ok: false; reasons: ReasonCode[]; message?: string };

/**
 * Explicit send of selected invitations (SR-04, SR-11). Each one is locked
 * and its eligibility rechecked now; a stale, ineligible or already-sent
 * invitation is refused with its reasons. Creates at most one initial intent.
 */
export async function sendInvitations(tx: Tx, actor: Actor, shopId: string, items: { id: string; revision: number }[], now = new Date()): Promise<SendResult[]> {
  if (items.length === 0) throw new InvitationError("invalid", "Select at least one invitation.");
  if (items.length > 500) throw new InvitationError("invalid", "Send at most 500 invitations at a time.");
  const facts = await shopFacts(tx, shopId, true);
  const rows = await selectRows(
    tx,
    and(
      eq(invitation.shopId, shopId),
      inArray(
        invitation.id,
        items.map((i) => i.id),
      ),
    ),
    true,
  );
  const evaluated = new Map((await evaluate(tx, shopId, rows, facts)).map((e) => [e.row.id, e]));
  const results: SendResult[] = [];

  for (const item of items) {
    const e = evaluated.get(item.id);
    if (!e) {
      results.push({ id: item.id, ok: false, reasons: [], message: "Not found at this shop." });
      continue;
    }
    if (e.row.revision !== item.revision) {
      results.push({ id: item.id, ok: false, reasons: [], message: "Changed since you loaded the page. Reload and try again." });
      continue;
    }
    if (e.blockers.length > 0) {
      results.push({ id: item.id, ok: false, reasons: e.blockers });
      continue;
    }
    const [created] = await tx
      .insert(emailIntent)
      .values({
        invitationId: item.id,
        kind: "initial",
        idempotencyKey: `invitation:${item.id}:initial`,
        recipient: e.row.emailNormalized!,
        isTest: e.row.isTest,
        createdBy: actor.type === "user" ? actor.userId : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: emailIntent.id });
    if (!created) {
      results.push({ id: item.id, ok: false, reasons: ["ALREADY_SENT"] });
      continue;
    }
    await tx.update(invitation).set({ status: "eligible", reasons: [], revision: e.row.revision + 1, updatedAt: now }).where(eq(invitation.id, item.id));
    await recordAudit({ ...auditActor(actor), shopId, action: "invitation.send_requested", subjectType: "invitation", subjectId: item.id, after: { emailIntentId: created.id } }, tx);
    results.push({ id: item.id, ok: true });
  }
  return results;
}

/**
 * Correct a visit's email or delivery date (SR-11). Saving never sends: PSG
 * uses Send invitation afterwards, which rechecks everything.
 */
export async function correctInvitation(tx: Tx, actor: Actor, shopId: string, id: string, expectedRevision: number, input: { email: string; deliveredOn: string }, now = new Date()) {
  const [row] = await selectRows(tx, and(eq(invitation.shopId, shopId), eq(invitation.id, id)), true);
  if (!row) throw new InvitationError("not_found", "This invitation no longer exists.");
  if (row.revision !== expectedRevision) throw new InvitationError("conflict", "This invitation changed since you opened it. Reload and try again.");

  const email = input.email.trim();
  const emailNormalized = email ? normalizeEmail(email) : null;
  if (email && !emailNormalized) throw new InvitationError("invalid", "Enter a valid email address.");
  const deliveredOn = input.deliveredOn.trim() || null;
  if (deliveredOn && !isIsoDate(deliveredOn)) throw new InvitationError("invalid", "Enter a real delivery date.");

  const before = { email: row.email, deliveredOn: row.deliveredOn };
  const after = { email: emailNormalized ? email : null, deliveredOn };
  if (before.email === after.email && before.deliveredOn === after.deliveredOn) return { revision: row.revision };

  await tx.update(customer).set({ email: after.email, emailNormalized }).where(eq(customer.id, row.customerId));
  await tx.update(repairVisit).set({ deliveredOn, deliveredOnRaw: deliveredOn ?? row.deliveredOnRaw }).where(eq(repairVisit.id, row.visitId));
  const [updated] = await tx.update(invitation).set({ revision: row.revision + 1, updatedAt: now }).where(eq(invitation.id, id)).returning({ revision: invitation.revision });
  await recordAudit({ ...auditActor(actor), shopId, action: "invitation.contact_corrected", subjectType: "invitation", subjectId: id, before, after }, tx);
  return { revision: updated.revision };
}

/** Reasons that still allow a printed link: the survey is valid, only email delivery is missing (SR-09). */
const PRINTABLE_DESPITE: readonly ReasonCode[] = ["EMAIL_NEEDED", "TEST_RECIPIENT_NOT_ALLOWED"];

/**
 * Issue a printable survey link for one invitation. The token is returned
 * once and only its hash is stored (SR-12). Its lifetime starts now, when
 * PSG issues it (proposal P-03).
 */
export async function issuePrintableLink(tx: Tx, actor: Actor, shopId: string, id: string, now = new Date()) {
  const facts = await shopFacts(tx, shopId, true);
  const rows = await selectRows(tx, and(eq(invitation.shopId, shopId), eq(invitation.id, id)), true);
  if (rows.length === 0) throw new InvitationError("not_found", "This invitation no longer exists.");
  const [e] = await evaluate(tx, shopId, rows, facts);
  // Checked here, not only by hiding the button (SR-40): an answered visit or a cancelled email never gets a new link (SR-08, SR-24).
  if (e.answered) throw new InvitationError("invalid", "A printable link cannot be issued: the survey was already answered for this visit.", ["SURVEY_ANSWERED"]);
  if (e.intentState === "cancelled") throw new InvitationError("invalid", "A printable link cannot be issued: this invitation was cancelled.");
  const blocking = e.intentState ? [] : e.blockers.filter((b) => !PRINTABLE_DESPITE.includes(b));
  if (blocking.length > 0) throw new InvitationError("invalid", "A printable link cannot be issued yet.", blocking);

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + facts.linkLifetimeDays * 24 * 60 * 60 * 1000);
  await tx.insert(accessToken).values({ invitationId: id, tokenHash: hashToken(token), issuedAt: now, expiresAt });
  await recordAudit({ ...auditActor(actor), shopId, action: "invitation.link_issued", subjectType: "invitation", subjectId: id, after: { expiresAt: expiresAt.toISOString(), purpose: "print" } }, tx);
  return { token, expiresAt };
}
