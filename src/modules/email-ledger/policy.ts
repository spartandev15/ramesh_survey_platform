import { isExcluded, type ReasonCode } from "@/modules/imports/eligibility";
import { dispatchBlock, type SendKind, type ShopMode } from "@/modules/shops/settings-policy";

/**
 * Email ledger rules (SR-23..SR-26; PDF 04 "Email delivery semantics"). Pure
 * so every decision is unit-tested; the store applies them under row locks
 * immediately before each provider call.
 */

const MAX_SEND_ATTEMPTS = 3;
export const LEASE_MS = 5 * 60 * 1000;
export const MAX_RENEWALS = 3;
const DAY = 24 * 60 * 60 * 1000;

export type StopReason =
  | ReasonCode
  | "SUBMITTED"
  | "INITIAL_NOT_ACCEPTED"
  | "LINK_EXPIRED"
  | "OVERDUE_AFTER_PAUSE"
  | "NOT_IMPORTED";

export const STOP_LABELS: Record<string, string> = {
  SUBMITTED: "Survey already submitted",
  INITIAL_NOT_ACCEPTED: "First invitation was not delivered",
  LINK_EXPIRED: "Survey link has expired",
  OVERDUE_AFTER_PAUSE: "Became due while the shop was paused: needs PSG review",
  NOT_IMPORTED: "Not an imported visit",
};

export interface DispatchFacts {
  kind: SendKind;
  mode: ShopMode;
  isTest: boolean;
  recipientAllowlisted: boolean;
  optedOut: boolean;
  submitted: boolean;
  /** Current import eligibility of the visit (initial sends only). */
  blockers: ReasonCode[];
  /** Reminder: the initial invitation was accepted by the provider. */
  initialAccepted: boolean;
  /** Reminder: the survey link is still open. */
  linkOpen: boolean;
}

export type DispatchDecision = { action: "send" } | { action: "hold"; reason: StopReason } | { action: "cancel"; reason: StopReason };

/**
 * Final check before the provider call (SR-26: recheck at dispatch, not only
 * at enqueue). Cancel is final; hold waits for explicit PSG release, so a
 * paused shop never bulk-sends on resume (proposal P-04).
 */
export function decideDispatch(f: DispatchFacts): DispatchDecision {
  if (f.submitted) return { action: "cancel", reason: "SUBMITTED" };
  if (f.optedOut) return { action: "cancel", reason: "SHOP_OPT_OUT" };
  // A production record never emails from a Test-mode shop (SR-03); it waits
  // for Live rather than being cancelled, so PSG can still select it (SR-04).
  if (!f.isTest && f.mode === "test") return { action: "hold", reason: "PREACTIVATION_IMPORT" };
  const block = dispatchBlock({ mode: f.mode, kind: f.kind, isTestRecord: f.isTest, recipientAllowlisted: f.recipientAllowlisted });
  if (block === "TEST_RECIPIENT_NOT_ALLOWED") return { action: "cancel", reason: block };
  if (block === "SHOP_PAUSED") return { action: "hold", reason: block };

  if (f.kind === "initial") {
    if (isExcluded(f.blockers)) return { action: "cancel", reason: f.blockers.find((b) => b.startsWith("LEGACY_"))! };
    const other = f.blockers.find((b) => b !== "SHOP_PAUSED" && b !== "PREACTIVATION_IMPORT" && b !== "SHOP_OPT_OUT" && b !== "TEST_RECIPIENT_NOT_ALLOWED");
    if (other) return { action: "hold", reason: other };
  }
  if (f.kind === "reminder") {
    if (!f.initialAccepted) return { action: "cancel", reason: "INITIAL_NOT_ACCEPTED" };
    if (!f.linkOpen) return { action: "cancel", reason: "LINK_EXPIRED" };
  }
  return { action: "send" };
}

/** Reminder due = accepted initial time + configured delay (PDF 04 proposed baseline). */
export function reminderDueAt(initialAcceptedAt: Date, delayDays: number): Date {
  return new Date(initialAcceptedAt.getTime() + delayDays * DAY);
}

/**
 * A reminder that fell due before the current Live period began waits for
 * PSG review instead of sending automatically (proposal P-04).
 */
export function reminderStartsHeld(dueAt: Date, liveSince: Date | null): boolean {
  return liveSince === null || dueAt.getTime() < liveSince.getTime();
}

/** After a definite provider rejection: retry the same intent with backoff, then give up. */
export function afterRejection(attempts: number, now: Date): { state: "queued"; dueAt: Date } | { state: "failed" } {
  if (attempts >= MAX_SEND_ATTEMPTS) return { state: "failed" };
  return { state: "queued", dueAt: new Date(now.getTime() + attempts * 5 * 60 * 1000) };
}

/**
 * How a provider event moves an intent. Events can arrive late or out of
 * order, so a later state is never downgraded (delivered stays delivered).
 */
export function stateAfterEvent(current: string, eventType: string): string | null {
  const rank: Record<string, number> = { acceptance_unknown: 0, sending: 0, accepted: 1, delivered: 2, bounced: 2 };
  const target = ({ processed: "accepted", deferred: "accepted", delivered: "delivered", bounce: "bounced", dropped: "bounced", blocked: "bounced" } as Record<string, string>)[eventType];
  if (!target || !(current in rank)) return null;
  return rank[target] > rank[current] || (current === "acceptance_unknown" && target === "accepted") ? target : null;
}

export function linkExpiry(kind: SendKind, now: Date, lifetimeDays: number, currentExpiry: Date | null): Date {
  // A reminder carries the same deadline as the invitation (SR-21); a renewal starts a new lifetime.
  if (kind === "reminder" && currentExpiry) return currentExpiry;
  return new Date(now.getTime() + lifetimeDays * DAY);
}
