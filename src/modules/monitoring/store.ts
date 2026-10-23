import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { inOrder, type Tx } from "@/db/client";
import { alertCase, bridgeEvent, emailIntent, invitation, opsNotice, rateLimit, repairVisit, session, suppressionAction, surveyResponse, verification } from "@/db/schema";
import { SUPPRESSION_OVERDUE_HOURS } from "@/modules/operations/policy";
import { ERROR_SPIKE_WINDOW_MINUTES, type DailyCounts, type HealthFacts } from "./policy";

/** Keeps the database small: expired sign-ins and reset links, and rate-limit counters idle for a day (the longest window is an hour). */
export async function removeExpired(tx: Tx, now: Date) {
  const sessions = await tx.delete(session).where(lt(session.expiresAt, now));
  const links = await tx.delete(verification).where(lt(verification.expiresAt, now));
  const limits = await tx.delete(rateLimit).where(lt(rateLimit.lastRequest, now.getTime() - 24 * 60 * 60 * 1000));
  return { sessions: sessions.rowCount ?? 0, links: links.rowCount ?? 0, limits: limits.rowCount ?? 0 };
}

/** Facts for the queue-health check. Production only: test sends never page anyone. */
export async function healthFacts(tx: Tx, now: Date): Promise<HealthFacts> {
  const since = new Date(now.getTime() - ERROR_SPIKE_WINDOW_MINUTES * 60_000);
  const [email] = await tx
    .select({
      queuedDue: sql<number>`count(*) FILTER (WHERE ${emailIntent.state} = 'queued' AND ${emailIntent.dueAt} <= ${now})::int`,
      oldestQueuedDue: sql<Date | null>`min(${emailIntent.dueAt}) FILTER (WHERE ${emailIntent.state} = 'queued' AND ${emailIntent.dueAt} <= ${now})`,
      recentErrors: sql<number>`count(*) FILTER (WHERE ${emailIntent.state} IN ('failed', 'bounced', 'acceptance_unknown') AND ${emailIntent.updatedAt} >= ${since})::int`,
    })
    .from(emailIntent)
    .where(eq(emailIntent.isTest, false));
  const [bridge] = await tx
    .select({ problems: sql<number>`count(*)::int` })
    .from(bridgeEvent)
    .where(inArray(bridgeEvent.state, ["failed", "conflict"]));
  return {
    queuedDue: email.queuedDue,
    oldestQueuedDue: email.oldestQueuedDue ? new Date(email.oldestQueuedDue) : null,
    recentEmailErrors: email.recentErrors,
    bridgeProblems: bridge.problems,
  };
}

/** Production counts for the daily reconciliation: the last 24 hours, and what is open now. */
export async function dailyCounts(tx: Tx, now: Date): Promise<DailyCounts> {
  const since = new Date(now.getTime() - 86_400_000);
  const overdueBefore = new Date(now.getTime() - SUPPRESSION_OVERDUE_HOURS * 3_600_000);
  const count = sql<number>`count(*)::int`;

  // One transaction is one connection: run the counts one after another, never overlapping.
  const [[visits], [invitations], [email], [responses], [alerts], [suppression], [bridge]] = await inOrder([
    tx.select({ n: count }).from(repairVisit).where(and(eq(repairVisit.isTest, false), gte(repairVisit.createdAt, since))),
    tx.select({ n: count }).from(invitation).where(and(eq(invitation.isTest, false), gte(invitation.createdAt, since))),
    tx
      .select({
        initial: sql<number>`count(*) FILTER (WHERE ${emailIntent.kind} = 'initial' AND ${emailIntent.acceptedAt} >= ${since})::int`,
        reminder: sql<number>`count(*) FILTER (WHERE ${emailIntent.kind} = 'reminder' AND ${emailIntent.acceptedAt} >= ${since})::int`,
        renewal: sql<number>`count(*) FILTER (WHERE ${emailIntent.kind} = 'renewal' AND ${emailIntent.acceptedAt} >= ${since})::int`,
        alert: sql<number>`count(*) FILTER (WHERE ${emailIntent.kind} = 'alert' AND ${emailIntent.acceptedAt} >= ${since})::int`,
        queuedDue: sql<number>`count(*) FILTER (WHERE ${emailIntent.state} = 'queued' AND ${emailIntent.dueAt} <= ${now})::int`,
        held: sql<number>`count(*) FILTER (WHERE ${emailIntent.state} = 'held')::int`,
        needReview: sql<number>`count(*) FILTER (WHERE ${emailIntent.state} IN ('failed', 'bounced', 'acceptance_unknown'))::int`,
      })
      .from(emailIntent)
      .where(eq(emailIntent.isTest, false)),
    tx
      .select({
        online: sql<number>`count(*) FILTER (WHERE ${surveyResponse.source} = 'online' AND ${surveyResponse.submittedAt} >= ${since})::int`,
        paper: sql<number>`count(*) FILTER (WHERE ${surveyResponse.source} = 'paper' AND ${surveyResponse.submittedAt} >= ${since})::int`,
        public: sql<number>`count(*) FILTER (WHERE ${surveyResponse.source} = 'public' AND ${surveyResponse.submittedAt} >= ${since})::int`,
        pendingMatch: sql<number>`count(*) FILTER (WHERE ${surveyResponse.matchStatus} IN ('shop_unconfirmed', 'visit_unmatched'))::int`,
        duplicateReview: sql<number>`count(*) FILTER (WHERE ${surveyResponse.matchStatus} = 'duplicate_review')::int`,
      })
      .from(surveyResponse)
      .where(and(eq(surveyResponse.isTest, false), eq(surveyResponse.status, "submitted"))),
    tx
      .select({
        raised: sql<number>`count(*) FILTER (WHERE ${alertCase.createdAt} >= ${since})::int`,
        waiting: sql<number>`count(*) FILTER (WHERE ${alertCase.status} = 'pending_review')::int`,
        oldestWaiting: sql<Date | null>`min(${alertCase.createdAt}) FILTER (WHERE ${alertCase.status} = 'pending_review')`,
      })
      .from(alertCase)
      .where(eq(alertCase.isTest, false)),
    tx
      .select({
        outstanding: count,
        overdue: sql<number>`count(*) FILTER (WHERE ${suppressionAction.createdAt} <= ${overdueBefore})::int`,
      })
      .from(suppressionAction)
      .where(and(eq(suppressionAction.isTest, false), eq(suppressionAction.status, "outstanding"))),
    tx
      .select({
        waiting: sql<number>`count(*) FILTER (WHERE ${bridgeEvent.state} IN ('pending', 'retrying'))::int`,
        problems: sql<number>`count(*) FILTER (WHERE ${bridgeEvent.state} IN ('failed', 'conflict'))::int`,
      })
      .from(bridgeEvent),
  ]);

  return {
    visitsImported: visits.n,
    invitationsCreated: invitations.n,
    emailsAccepted: { initial: email.initial, reminder: email.reminder, renewal: email.renewal, alert: email.alert },
    responsesSubmitted: { online: responses.online, paper: responses.paper, public: responses.public },
    alertsRaised: alerts.raised,
    emailsQueuedDue: email.queuedDue,
    emailsHeld: email.held,
    emailsNeedReview: email.needReview,
    pendingMatch: responses.pendingMatch,
    duplicateReview: responses.duplicateReview,
    alertsWaitingReview: alerts.waiting,
    oldestAlertWaiting: alerts.oldestWaiting ? new Date(alerts.oldestWaiting) : null,
    suppressionOutstanding: suppression.outstanding,
    suppressionOverdue: suppression.overdue,
    bridgeWaiting: bridge.waiting,
    bridgeProblems: bridge.problems,
  };
}

/** The stored notice for a key, locked so a second worker waits instead of sending the same notice. */
export async function lockNotice(tx: Tx, key: string) {
  const [row] = await tx.select().from(opsNotice).where(eq(opsNotice.key, key)).for("update");
  return row ?? null;
}

export async function saveNotice(tx: Tx, key: string, values: { open: boolean; detail: string; sent: boolean }, now: Date) {
  await tx
    .insert(opsNotice)
    .values({ key, open: values.open, detail: values.detail, firstSeenAt: now, lastSentAt: values.sent ? now : null, updatedAt: now })
    .onConflictDoUpdate({
      target: opsNotice.key,
      set: {
        open: values.open,
        detail: values.detail,
        // A problem that starts again after recovering is a new occurrence.
        firstSeenAt: sql`CASE WHEN ${opsNotice.open} THEN ${opsNotice.firstSeenAt} ELSE ${now} END`,
        lastSentAt: values.sent ? now : sql`${opsNotice.lastSentAt}`,
        updatedAt: now,
      },
    });
}

/** Claim today's report; only the worker that claims it sends it (idempotent across restarts and workers). */
export async function claimReport(tx: Tx, key: string, now: Date): Promise<boolean> {
  const created = await tx.insert(opsNotice).values({ key, open: false, detail: "daily report", firstSeenAt: now, lastSentAt: now, updatedAt: now }).onConflictDoNothing().returning({ key: opsNotice.key });
  return created.length > 0;
}
