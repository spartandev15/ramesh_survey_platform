import type { MatchStatus } from "@/modules/responses/staff-store";

export const SOURCE_LABELS: Record<string, string> = { online: "Online link", paper: "Paper", public: "Public form" };

/** One plain status per response; colour is never the only signal (SR-39). */
export function responseStatus(r: { matchStatus: MatchStatus; canonical: boolean; duplicateDisposition: string | null }) {
  if (r.matchStatus === "visit_unmatched") return { label: "Pending customer match", style: "bg-amber-100 text-amber-800" };
  if (r.matchStatus === "shop_unconfirmed") return { label: "Shop not confirmed", style: "bg-amber-100 text-amber-800" };
  if (r.matchStatus === "duplicate_review") return { label: "Duplicate review", style: "bg-brand-red/10 text-brand-red-dark" };
  if (r.canonical) return { label: "Counted", style: "bg-emerald-100 text-emerald-800" };
  if (r.duplicateDisposition === "legacy_reference") return { label: "Legacy reference, not counted", style: "bg-gray-200 text-gray-800" };
  return { label: "Duplicate, not counted", style: "bg-gray-200 text-gray-800" };
}
