import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { legacySurveyLedger, repairVisit, surveyResponse } from "@/db/schema";

/**
 * Where a submitted response belongs (SR-19, SR-28). The first committed
 * submission for a visit is the counted (canonical) one; later ones are kept
 * for PSG duplicate review; a visit already surveyed in the legacy system
 * keeps the response only as a reference (PDF 03 section 4).
 *
 * Locks the visit row, so concurrent online and paper submits for the same
 * visit serialize (AT-19). A unique index backs this up in the database.
 */
export type Placement =
  | { matchStatus: "matched"; canonical: true; duplicateDisposition: null }
  | { matchStatus: "matched"; canonical: false; duplicateDisposition: "legacy_reference" }
  | { matchStatus: "duplicate_review"; canonical: false; duplicateDisposition: null }
  | { matchStatus: "visit_unmatched"; canonical: false; duplicateDisposition: null };

export async function placeForVisit(tx: Tx, visitId: string | null, exceptResponseId?: string): Promise<Placement> {
  // A PSG test link has no visit: it is its own counted result (test data never enters reports anyway).
  if (!visitId) return { matchStatus: "matched", canonical: true, duplicateDisposition: null };

  const [visit] = await tx.select().from(repairVisit).where(eq(repairVisit.id, visitId)).for("update");
  if (!visit) throw new Error(`Repair visit ${visitId} not found`);

  const [legacy] = await tx
    .select({ id: legacySurveyLedger.id })
    .from(legacySurveyLedger)
    .where(and(eq(legacySurveyLedger.shopId, visit.shopId), eq(legacySurveyLedger.sourceSystem, visit.sourceSystem), eq(legacySurveyLedger.sourceVisitKey, visit.sourceVisitKey)));
  // Must not circumvent legacy eligibility (SR-08).
  if (legacy) return { matchStatus: "matched", canonical: false, duplicateDisposition: "legacy_reference" };

  const [existing] = await tx
    .select({ id: surveyResponse.id })
    .from(surveyResponse)
    .where(and(eq(surveyResponse.visitId, visitId), eq(surveyResponse.canonical, true)));
  if (existing && existing.id !== exceptResponseId) return { matchStatus: "duplicate_review", canonical: false, duplicateDisposition: null };
  return { matchStatus: "matched", canonical: true, duplicateDisposition: null };
}
