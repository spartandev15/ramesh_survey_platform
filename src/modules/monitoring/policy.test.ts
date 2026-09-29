/**
 * Queue-health notices and the daily reconciliation (PDF 09 daily operating
 * loop): thresholds, when a notice is sent, repeated and cleared, and what
 * the daily email says.
 */
import { describe, expect, it } from "vitest";
import { dailyReportEmail, findProblems, noticeAction, noticeEmail, reportKey, type DailyCounts } from "./policy";

const now = new Date("2026-10-05T15:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const calm = { queuedDue: 0, oldestQueuedDue: null, recentEmailErrors: 0, bridgeProblems: 0 };

describe("queue health", () => {
  it("is quiet when nothing is stuck or failing", () => {
    expect(findProblems(calm, now)).toEqual([]);
  });

  it("flags survey emails due for 15 minutes or more, not less", () => {
    expect(findProblems({ ...calm, queuedDue: 3, oldestQueuedDue: minutesAgo(14) }, now)).toEqual([]);
    const [problem] = findProblems({ ...calm, queuedDue: 3, oldestQueuedDue: minutesAgo(15) }, now);
    expect(problem.key).toBe("email_dispatch_stuck");
    expect(problem.summary).toContain("3 survey emails are due but not sent; the oldest has waited 15 minutes");
  });

  it("flags an error spike from five failures in the window", () => {
    expect(findProblems({ ...calm, recentEmailErrors: 4 }, now)).toEqual([]);
    expect(findProblems({ ...calm, recentEmailErrors: 5 }, now).map((p) => p.key)).toEqual(["email_error_spike"]);
  });

  it("flags any failed or conflicting FileMaker bridge record", () => {
    expect(findProblems({ ...calm, bridgeProblems: 1 }, now)[0].summary).toContain("1 FileMaker bridge record failed");
  });
});

describe("notice timing", () => {
  it("sends when a problem starts, stays quiet within the hour, repeats hourly and clears once", () => {
    expect(noticeAction(null, true, now)).toBe("send");
    expect(noticeAction({ open: true, lastSentAt: minutesAgo(59) }, true, now)).toBe("none");
    expect(noticeAction({ open: true, lastSentAt: minutesAgo(60) }, true, now)).toBe("repeat");
    expect(noticeAction({ open: true, lastSentAt: minutesAgo(5) }, false, now)).toBe("recover");
    expect(noticeAction({ open: false, lastSentAt: minutesAgo(5) }, false, now)).toBe("none");
    expect(noticeAction(null, false, now)).toBe("none");
    // A problem that comes back after clearing is a new notice.
    expect(noticeAction({ open: false, lastSentAt: minutesAgo(5) }, true, now)).toBe("send");
  });

  it("links to the queues and says when a notice is resolved", () => {
    const first = noticeEmail("email_dispatch_stuck", "send", "3 survey emails are due", "https://hub.test");
    expect(first.subject).toBe("[PSG Hub] Action needed: Survey emails are not being sent");
    expect(first.text).toContain("https://hub.test/psg/operations");
    expect(noticeEmail("email_dispatch_stuck", "repeat", "x", "https://hub.test").subject).toContain("Still open");
    expect(noticeEmail("email_dispatch_stuck", "recover", "x", "https://hub.test").text).toContain("back to normal");
  });
});

describe("daily reconciliation", () => {
  const counts: DailyCounts = {
    visitsImported: 40,
    invitationsCreated: 38,
    emailsAccepted: { initial: 35, reminder: 12, renewal: 1, alert: 2 },
    responsesSubmitted: { online: 9, paper: 2, public: 1 },
    alertsRaised: 3,
    emailsQueuedDue: 0,
    emailsHeld: 2,
    emailsNeedReview: 1,
    pendingMatch: 4,
    duplicateReview: 0,
    alertsWaitingReview: 1,
    oldestAlertWaiting: new Date(now.getTime() - 5 * 3_600_000),
    suppressionOutstanding: 2,
    suppressionOverdue: 1,
    bridgeWaiting: 0,
    bridgeProblems: 0,
  };

  it("uses one key per day in the report zone", () => {
    // 03:30 UTC is still the previous evening in New York.
    expect(reportKey(new Date("2026-10-06T03:30:00Z"))).toBe("daily_report:2026-10-05");
    expect(reportKey(new Date("2026-10-06T12:00:00Z"))).toBe("daily_report:2026-10-06");
  });

  it("states the day's counts and every open item with where to handle it", () => {
    const email = dailyReportEmail(counts, now, "https://hub.test");
    expect(email.subject).toBe("[PSG Hub] Daily counts for Oct 5, 2026: 5 items open");
    expect(email.text).toContain("Production shops only; test data is left out.");
    expect(email.text).toContain("- Repair visits imported: 40");
    expect(email.text).toContain("35 first invitations, 12 reminders, 1 renewed links, 2 shop alerts");
    expect(email.text).toContain("9 online, 2 paper, 1 public form (12 in all)");
    expect(email.text).toContain("1 alert waiting for PSG review, oldest 5 hours: Alert review");
    expect(email.text).toContain("2 routine-mail changes to apply in FileMaker, 1 overdue: Suppression queue");
    expect(email.text).not.toContain("possible duplicate");
  });

  it("says plainly when nothing is waiting", () => {
    const quiet = { ...counts, emailsHeld: 0, emailsNeedReview: 0, pendingMatch: 0, alertsWaitingReview: 0, oldestAlertWaiting: null, suppressionOutstanding: 0, suppressionOverdue: 0 };
    const email = dailyReportEmail(quiet, now, "https://hub.test");
    expect(email.subject).toBe("[PSG Hub] Daily counts for Oct 5, 2026");
    expect(email.text).toContain("- Nothing is waiting for a person.");
  });
});
