/**
 * Queue-health notices and the daily reconciliation for PSG operations
 * (PDF 09, daily operating loop: "queue-health alerts within 15 minutes for
 * stuck dispatch/error spikes and daily reconciliation for counts"). Pure
 * logic so every threshold is unit-tested; the store supplies the facts.
 *
 * A stopped worker cannot report itself, so /api/health answers 503 for an
 * outside uptime monitor instead (see app/api/health).
 */

/** Proposed thresholds from PDF 09; PSG sets the real ones at kickoff. */
const DISPATCH_STUCK_MINUTES = 15;
export const ERROR_SPIKE_WINDOW_MINUTES = 15;
const ERROR_SPIKE_COUNT = 5;
/** An ongoing problem is repeated this often, never on every check. */
const REPEAT_MINUTES = 60;

export const PROBLEM_KEYS = ["email_dispatch_stuck", "email_error_spike", "bridge_problems"] as const;
export type ProblemKey = (typeof PROBLEM_KEYS)[number];

export interface HealthFacts {
  /** Production survey emails that are due and still queued. */
  queuedDue: number;
  oldestQueuedDue: Date | null;
  /** Production emails that failed, bounced or ended acceptance-unknown within the spike window. */
  recentEmailErrors: number;
  /** FileMaker bridge events that failed or conflict. */
  bridgeProblems: number;
}

export interface Problem {
  key: ProblemKey;
  summary: string;
}

const minutesBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 60_000);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function findProblems(facts: HealthFacts, now: Date): Problem[] {
  const problems: Problem[] = [];
  if (facts.oldestQueuedDue && minutesBetween(facts.oldestQueuedDue, now) >= DISPATCH_STUCK_MINUTES) {
    problems.push({
      key: "email_dispatch_stuck",
      summary: `${plural(facts.queuedDue, "survey email is", "survey emails are")} due but not sent; the oldest has waited ${minutesBetween(facts.oldestQueuedDue, now)} minutes. Check that the worker is running and the email provider accepts mail.`,
    });
  }
  if (facts.recentEmailErrors >= ERROR_SPIKE_COUNT) {
    problems.push({
      key: "email_error_spike",
      summary: `${plural(facts.recentEmailErrors, "email")} failed, bounced or ended with an unknown result in the last ${ERROR_SPIKE_WINDOW_MINUTES} minutes. Review them in Email review and reconcile with the provider before any retry.`,
    });
  }
  if (facts.bridgeProblems > 0) {
    problems.push({
      key: "bridge_problems",
      summary: `${plural(facts.bridgeProblems, "FileMaker bridge record")} failed or conflict and need a person on the FileMaker bridge page.`,
    });
  }
  return problems;
}

export type NoticeAction = "send" | "repeat" | "recover" | "none";

/** What to email for one problem, given what was last sent about it. */
export function noticeAction(stored: { open: boolean; lastSentAt: Date | null } | null, problemNow: boolean, now: Date): NoticeAction {
  if (problemNow) {
    if (!stored || !stored.open) return "send";
    if (!stored.lastSentAt || now.getTime() - stored.lastSentAt.getTime() >= REPEAT_MINUTES * 60_000) return "repeat";
    return "none";
  }
  return stored?.open ? "recover" : "none";
}

const PROBLEM_TITLES: Record<ProblemKey, string> = {
  email_dispatch_stuck: "Survey emails are not being sent",
  email_error_spike: "Many survey emails are failing",
  bridge_problems: "FileMaker bridge records need attention",
};

export function noticeEmail(key: ProblemKey, action: Exclude<NoticeAction, "none">, detail: string, appUrl: string) {
  const title = PROBLEM_TITLES[key];
  const prefix = action === "recover" ? "Resolved" : action === "repeat" ? "Still open" : "Action needed";
  const text =
    action === "recover"
      ? `${title}: this is back to normal. No action is needed.\n\nPSG Hub operations`
      : `${detail}\n\nOpen the operator queues: ${appUrl}/psg/operations\nSystem health is on the Overview: ${appUrl}/psg\n\n${action === "repeat" ? `This is still open; you will hear again in ${REPEAT_MINUTES} minutes while it lasts.\n\n` : ""}PSG Hub operations`;
  return { subject: `[PSG Hub] ${prefix}: ${title}`, text };
}

// ---------------------------------------------------------------------------
// Daily reconciliation
// ---------------------------------------------------------------------------

/** Production counts only: test data never counts as operational work. */
export interface DailyCounts {
  // Activity in the 24 hours before the report.
  visitsImported: number;
  invitationsCreated: number;
  emailsAccepted: { initial: number; reminder: number; renewal: number; alert: number };
  responsesSubmitted: { online: number; paper: number; public: number };
  alertsRaised: number;
  // Open work when the report ran.
  emailsQueuedDue: number;
  emailsHeld: number;
  emailsNeedReview: number;
  pendingMatch: number;
  duplicateReview: number;
  alertsWaitingReview: number;
  oldestAlertWaiting: Date | null;
  suppressionOutstanding: number;
  suppressionOverdue: number;
  bridgeWaiting: number;
  bridgeProblems: number;
}

/** The report's date and time are shown in this zone (a proposal to confirm with PSG). */
export const REPORT_TIMEZONE = "America/New_York";

/** One report per calendar day in the report zone, so a restarted or second worker never sends it twice. */
export function reportKey(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `daily_report:${day}`;
}

export function dailyReportEmail(c: DailyCounts, now: Date, appUrl: string) {
  const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: REPORT_TIMEZONE, timeZoneName: "short" }).format(now);
  const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: REPORT_TIMEZONE }).format(now);
  const sent = c.emailsAccepted;
  const got = c.responsesSubmitted;
  const waitingHours = c.oldestAlertWaiting ? Math.floor((now.getTime() - c.oldestAlertWaiting.getTime()) / 3_600_000) : null;
  const open = [
    c.emailsNeedReview > 0 && `${plural(c.emailsNeedReview, "email")} failed, bounced or unknown: Email review`,
    c.emailsHeld > 0 && `${plural(c.emailsHeld, "email")} held: Email review`,
    c.emailsQueuedDue > 0 && `${plural(c.emailsQueuedDue, "email")} due and not sent yet`,
    c.alertsWaitingReview > 0 && `${plural(c.alertsWaitingReview, "alert")} waiting for PSG review${waitingHours !== null ? `, oldest ${waitingHours} hours` : ""}: Alert review`,
    c.pendingMatch > 0 && `${plural(c.pendingMatch, "response")} waiting for a customer match: Responses`,
    c.duplicateReview > 0 && `${plural(c.duplicateReview, "possible duplicate")} to settle: Responses`,
    c.suppressionOutstanding > 0 && `${plural(c.suppressionOutstanding, "routine-mail change")} to apply in FileMaker${c.suppressionOverdue > 0 ? `, ${c.suppressionOverdue} overdue` : ""}: Suppression queue`,
    c.bridgeProblems > 0 && `${plural(c.bridgeProblems, "FileMaker bridge record")} failed or conflict: FileMaker bridge`,
    c.bridgeWaiting > 0 && `${plural(c.bridgeWaiting, "FileMaker bridge record")} waiting to be written`,
  ].filter((line): line is string => Boolean(line));

  const text = [
    `Daily counts for PSG Hub, ${when}. Production shops only; test data is left out.`,
    "",
    "Last 24 hours",
    `- Repair visits imported: ${c.visitsImported}`,
    `- Invitations created: ${c.invitationsCreated}`,
    `- Emails accepted by the provider: ${sent.initial} first invitations, ${sent.reminder} reminders, ${sent.renewal} renewed links, ${sent.alert} shop alerts`,
    `- Responses submitted: ${got.online} online, ${got.paper} paper, ${got.public} public form (${got.online + got.paper + got.public} in all)`,
    `- Negative alerts raised: ${c.alertsRaised}`,
    "",
    "Open now",
    ...(open.length > 0 ? open.map((line) => `- ${line}`) : ["- Nothing is waiting for a person."]),
    "",
    `Compare these with the import files and the email provider's own counts. Operator queues: ${appUrl}/psg/operations`,
    "",
    "PSG Hub operations",
  ].join("\n");
  return { subject: `[PSG Hub] Daily counts for ${day}${open.length > 0 ? `: ${plural(open.length, "item")} open` : ""}`, text };
}
