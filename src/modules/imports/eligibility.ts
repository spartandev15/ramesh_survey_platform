import { meetsDeliveryCutoff, type ShopMode } from "@/modules/shops/settings-policy";
import type { NormalizedVisit } from "./mapping";

/**
 * Import and send eligibility (SR-04..SR-11; PDF 03 section 2). Pure logic so
 * every rule is unit-tested. Reason codes follow the PDF import row contract.
 */

export const REASON_LABELS = {
  LEGACY_INVITED: "Already sent a survey in the legacy system",
  LEGACY_COMPLETED: "Already completed a survey in the legacy system",
  DUPLICATE_VISIT: "Same visit imported before",
  VISIT_IDENTITY_UNCERTAIN: "Visit identity unclear: needs PSG review",
  PREACTIVATION_IMPORT: "Imported before the shop went Live",
  BEFORE_CUTOFF: "Delivered before the cutoff date",
  DELIVERY_DATE_NEEDED: "Delivery date needed",
  EMAIL_NEEDED: "Email needed",
  SHOP_OPT_OUT: "Customer opted out at this shop",
  SHOP_PAUSED: "Shop is paused",
  TEST_RECIPIENT_NOT_ALLOWED: "Test record: address not on the internal test list",
  LEGACY_COVERAGE_UNKNOWN: "Legacy history for this shop not confirmed yet",
  ALREADY_SENT: "Invitation already sent",
  SURVEY_ANSWERED: "Survey already answered for this visit (link, paper or public form)",
} as const;

export type ReasonCode = keyof typeof REASON_LABELS;

export interface ShopFacts {
  mode: ShopMode;
  deliveryCutoff: string | null;
  legacyCoverageConfirmed: boolean;
}

export interface ExistingVisit {
  sourceVisitKey: string;
  emailNormalized: string | null;
  lastName: string | null;
  deliveredOn: string | null;
}

export interface VisitFacts {
  isTest: boolean;
  emailNormalized: string | null;
  deliveredOn: string | null;
  legacy: { invited: boolean; completed: boolean } | null;
  optedOut: boolean;
  recipientAllowlisted: boolean;
  /** A submitted response already exists for the visit, by any source (SR-24). Unknown at import. */
  answered?: boolean;
}

/**
 * Why a visit cannot be emailed right now; empty means it can be sent. Used at
 * import (with `atImport`) and again before every explicit send (SR-11).
 * At import, a production record in a Test or Paused shop waits for PSG
 * selection instead of sending (SR-04); an explicit send needs Live.
 */
export function sendBlockers(visit: VisitFacts, shop: ShopFacts): ReasonCode[] {
  const reasons: ReasonCode[] = [];
  if (visit.answered) reasons.push("SURVEY_ANSWERED");
  if (visit.legacy?.completed) reasons.push("LEGACY_COMPLETED");
  else if (visit.legacy?.invited) reasons.push("LEGACY_INVITED");
  if (!visit.isTest && !shop.legacyCoverageConfirmed) reasons.push("LEGACY_COVERAGE_UNKNOWN");
  if (!visit.deliveredOn) reasons.push("DELIVERY_DATE_NEEDED");
  // SR-10: never substitute the import date. A missing cutoff blocks production sends.
  else if (shop.deliveryCutoff ? !meetsDeliveryCutoff(visit.deliveredOn, shop.deliveryCutoff) : !visit.isTest) reasons.push("BEFORE_CUTOFF");
  if (!visit.emailNormalized) reasons.push("EMAIL_NEEDED");
  if (visit.optedOut) reasons.push("SHOP_OPT_OUT");
  if (visit.isTest) {
    if (visit.emailNormalized && !visit.recipientAllowlisted) reasons.push("TEST_RECIPIENT_NOT_ALLOWED");
  } else if (shop.mode === "test") reasons.push("PREACTIVATION_IMPORT");
  else if (shop.mode === "paused") reasons.push("SHOP_PAUSED");
  return reasons;
}

/** Legacy evidence, or an answer already given, excludes a visit for good (SR-08, SR-24); other reasons can clear. */
export function isExcluded(reasons: readonly ReasonCode[]): boolean {
  return reasons.includes("LEGACY_COMPLETED") || reasons.includes("LEGACY_INVITED") || reasons.includes("SURVEY_ANSWERED");
}

/**
 * Whether a row with an existing visit key is the same visit. Reused repair
 * order numbers are a known risk (PDF 04), so a different customer or
 * delivery date on the same key is held for review rather than merged.
 */
export function sameVisit(existing: ExistingVisit, row: NormalizedVisit): boolean {
  const differs = (a: string | null, b: string | null) => a !== null && b !== null && a.toLowerCase() !== b.toLowerCase();
  return !differs(existing.emailNormalized, row.emailNormalized) && !differs(existing.lastName, row.lastName) && !differs(existing.deliveredOn, row.deliveredOn);
}

export type RowPlan =
  | { action: "rejected"; reasons: ReasonCode[] }
  | { action: "held"; reasons: ReasonCode[]; createVisit: false }
  | { action: "reused"; reasons: ReasonCode[] }
  | { action: "created"; status: "eligible" | "held" | "excluded"; reasons: ReasonCode[]; send: boolean };

/**
 * What importing one visit row does. Only a new, fully eligible visit in a
 * Live shop (or an allowlisted test record) creates a send; a reimport never
 * sends again (SR-07).
 */
export function planVisitRow(row: NormalizedVisit, existing: ExistingVisit | null, facts: Omit<VisitFacts, "emailNormalized" | "deliveredOn">, shop: ShopFacts): RowPlan {
  if (!row.sourceVisitKey) return { action: "held", reasons: ["VISIT_IDENTITY_UNCERTAIN"], createVisit: false };
  if (existing) {
    return sameVisit(existing, row) ? { action: "reused", reasons: ["DUPLICATE_VISIT"] } : { action: "held", reasons: ["VISIT_IDENTITY_UNCERTAIN"], createVisit: false };
  }
  const reasons = sendBlockers({ ...facts, emailNormalized: row.emailNormalized, deliveredOn: row.deliveredOn }, shop);
  const status = isExcluded(reasons) ? "excluded" : reasons.length > 0 ? "held" : "eligible";
  return { action: "created", status, reasons, send: status === "eligible" };
}

/** Invitations PSG can pick from the waiting queue: only waiting on Live activation (SR-04). */
export const WAITING_REASONS: readonly ReasonCode[] = ["PREACTIVATION_IMPORT", "SHOP_PAUSED"];
