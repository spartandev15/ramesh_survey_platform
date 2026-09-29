/**
 * Operator queues (SR-38): which failures and waiting items need a person,
 * how late they are, and who owns them. Pure logic so it is unit-tested; the
 * store gathers items from the tables that own them.
 */

export const QUEUE_KINDS = ["held_import", "email_unknown", "delivery", "worker", "pending_match", "suppression"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const QUEUE_LABELS: Record<QueueKind, string> = {
  held_import: "Held imports",
  email_unknown: "Email outcome unknown",
  delivery: "Failed and held emails",
  worker: "Background jobs",
  pending_match: "Pending matches",
  suppression: "Suppression changes",
};

export const QUEUE_HELP: Record<QueueKind, string> = {
  held_import: "Imported visits that cannot be invited yet, and file rows that could not become a visit. Correct the details, then send from Invitations; for a row, fix the source and re-import, then mark it reviewed.",
  email_unknown: "The provider may or may not have sent these. Check the provider before deciding, because sending again could email the customer twice.",
  delivery: "Emails that failed, bounced or are waiting for PSG release after a pause.",
  worker: "Background job failures and a stopped worker. While the worker is down, no invitation, reminder or alert email is sent.",
  pending_match: "Submitted responses without a confirmed shop or visit, and duplicates. They do not count in scores until PSG decides.",
  suppression: "Routine-mail changes to apply by hand in FileMaker before the next mail run.",
};

/** Subjects an operator item can point at; the same names the audit log uses. */
export const SUBJECT_TYPES = ["invitation", "email_intent", "survey_response", "suppression_action", "worker_job", "worker", "import_row"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/** Items that leave the queue once a person records what they did: a failed job, or an import row that never became a visit. */
const REVIEWABLE_TYPES = ["worker_job", "import_row"] as const;
export type ReviewableType = (typeof REVIEWABLE_TYPES)[number];
export const isReviewableType = (value: string): value is ReviewableType => (REVIEWABLE_TYPES as readonly string[]).includes(value);

export const isSubjectType = (value: string): value is SubjectType => (SUBJECT_TYPES as readonly string[]).includes(value);

/**
 * Proposal (confirm with PSG, gate G-04): a suppression change is overdue
 * after 24 hours, because it must reach FileMaker before the next routine
 * mail run. Replace with the real mail-run schedule once PSG supplies it.
 */
export const SUPPRESSION_OVERDUE_HOURS = 24;

/** The worker records a heartbeat every minute; five quiet minutes means it has stopped. */
const WORKER_STALE_MINUTES = 5;

/** Worker failures stay visible for a week unless someone reviews them sooner. */
export const WORKER_FAILURE_DAYS = 7;

export function isSuppressionOverdue(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() >= SUPPRESSION_OVERDUE_HOURS * 60 * 60 * 1000;
}

export type WorkerHealth = { ok: true } | { ok: false; since: Date | null; reason: string };

export function workerHealth(lastHeartbeat: Date | null, now: Date): WorkerHealth {
  if (!lastHeartbeat) return { ok: false, since: null, reason: "The background worker has not run. No survey or alert email is sent until it starts." };
  if (now.getTime() - lastHeartbeat.getTime() < WORKER_STALE_MINUTES * 60 * 1000) return { ok: true };
  return { ok: false, since: lastHeartbeat, reason: "The background worker has stopped. No survey or alert email is sent until it restarts." };
}

export type OwnerFilter = "all" | "mine" | "unassigned";

export interface Sortable {
  overdue: boolean;
  since: Date;
  isTest: boolean;
  owner: { userId: string } | null;
}

/** Overdue first, then oldest first: the item waiting longest is at the top. */
export function sortItems<T extends Sortable>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.since.getTime() - b.since.getTime());
}

export function filterItems<T extends Sortable>(items: T[], filter: { owner: OwnerFilter; userId: string; includeTest: boolean }): T[] {
  return items.filter((item) => {
    if (!filter.includeTest && item.isTest) return false;
    if (filter.owner === "mine") return item.owner?.userId === filter.userId;
    if (filter.owner === "unassigned") return item.owner === null;
    return true;
  });
}

/** Plain-language names for audit actions shown in an item's history. Unknown actions show their code. */
const HISTORY_LABELS: Record<string, string> = {
  "operator.owner_assigned": "Owner assigned",
  "operator.owner_cleared": "Owner removed",
  "operator.failure_reviewed": "Failure reviewed",
  "operator.row_reviewed": "Import row reviewed",
  "invitation.send_requested": "Invitation send requested",
  "invitation.contact_corrected": "Contact details corrected",
  "invitation.link_issued": "Printable link issued",
  "email.accepted": "Provider accepted the email",
  "email.rejected": "Provider rejected the email",
  "email.unknown": "Provider outcome unknown",
  "email.acceptance_unknown": "Sender stopped mid-send: outcome unknown",
  "email.held": "Email held",
  "email.cancelled": "Email cancelled",
  "email.release": "Released to send",
  "email.retry": "Retry requested",
  "email.confirm_sent": "Confirmed sent from provider evidence",
  "email.confirm_not_sent": "Confirmed not sent: queued again",
  "email.renewal_requested": "Customer asked for a new link",
  "suppression.acknowledged": "Acknowledged as done in FileMaker",
};

export const historyLabel = (action: string) => HISTORY_LABELS[action] ?? action;
