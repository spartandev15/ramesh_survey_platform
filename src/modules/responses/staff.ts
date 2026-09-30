import "server-only";
import { getDb } from "@/db/client";
import { loadPage, pageOf } from "@/lib/pagination";
import { toCsv } from "@/lib/csv";
import { requireCapability } from "@/modules/access/principal";
import { recordAudit } from "@/modules/audit/audit";
import { versionDetails } from "@/modules/dashboard/store";
import { formatAnswer } from "@/modules/instruments/describe";
import { responseStatus, SOURCE_LABELS } from "./labels";
import type { RespondentContext, ResponseFilters } from "./staff-store";
import * as store from "./staff-store";

/**
 * Authorized PSG entry points for responses: paper entry (SR-18), matching
 * and duplicates (SR-19, SR-28, SR-29) and corrections (SR-20).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (...values: (string | null | undefined)[]) => values.every((v) => v === null || v === undefined || UUID_RE.test(v));
const notFound = () => new store.StaffResponseError("not_found", "This response no longer exists.");

const user = async (capability: Parameters<typeof requireCapability>[0]) => ({ type: "user" as const, userId: (await requireCapability(capability)).principal.userId });

export async function listResponses(filters: ResponseFilters, page: number, size?: number) {
  await requireCapability("psg.workspace");
  if (!ids(filters.shopId)) return pageOf([], 1);
  return getDb().transaction((tx) => loadPage(page, () => store.countResponses(tx, filters), (offset, n) => store.listResponses(tx, filters, offset, n), size));
}

/** A safety limit for one export, far above a working list. */
const EXPORT_LIMIT = 20_000;

/**
 * Responses as CSV: one (`ids` of one), the ticked rows, or every row the
 * filters match. Answers export under their question ids, as in the shop
 * results export. It names customers, so every export is audited (SR-40).
 */
export async function exportResponsesCsv(filters: ResponseFilters) {
  const { principal } = await requireCapability("psg.workspace");
  if (!ids(filters.shopId) || (filters.ids && (filters.ids.length > 1000 || !ids(...filters.ids)))) return null;
  return getDb().transaction(async (tx) => {
    const rows = await store.exportResponses(tx, filters, EXPORT_LIMIT);
    const versions = await versionDetails(tx, [...new Set(rows.flatMap((r) => [r.versionId, r.additionVersionId].filter((v): v is string => Boolean(v))))]);
    const questions = [...new Map([...versions.values()].flatMap((v) => v.definition.pages.flatMap((p) => p.questions)).map((q) => [q.id, q])).values()];
    const header = ["response_id", "submitted_at", "shop", "source", "status", "counted", "visit_id", "repair_order", "delivered_on", "customer_name", "customer_repair_order", "received_on", "survey_version", "test_data", "corrected", ...questions.map((q) => `answer:${q.id}`)];
    const body = rows.map((r) => {
      const ctx = (r.context ?? {}) as RespondentContext;
      const answers = r.answers ?? {};
      return [
        r.id,
        r.submittedAt?.toISOString() ?? "",
        r.shopName ?? "Not confirmed",
        SOURCE_LABELS[r.source] ?? r.source,
        responseStatus(r).label,
        r.matchStatus === "matched" && r.canonical ? "yes" : "no",
        r.sourceVisitKey ?? "",
        r.repairOrder ?? "",
        r.deliveredOn ?? "",
        ctx.name ?? "",
        ctx.repairOrder ?? "",
        r.receivedOn ?? "",
        (r.versionId && versions.get(r.versionId)?.label) ?? "",
        r.isTest ? "yes" : "no",
        r.revision > 1 ? "yes" : "no",
        ...questions.map((q) => formatAnswer(q, answers[q.id] as never) ?? ""),
      ];
    });
    await recordAudit({ actorType: "user", actorUserId: principal.userId, action: "responses.exported", subjectType: "survey_response", subjectId: filters.ids?.length === 1 ? filters.ids[0] : "list", after: { ...filters, rows: rows.length } }, tx);
    return { csv: toCsv(header, body), rows: rows.length };
  });
}

export async function monthlyQueueCounts() {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => store.monthlyQueueCounts(tx));
}

export async function matchQueueCounts() {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => store.countByMatchStatus(tx));
}

export async function getResponse(responseId: string) {
  await requireCapability("psg.workspace");
  if (!ids(responseId)) return null;
  return getDb().transaction((tx) => store.getFullResponse(tx, responseId));
}

export async function findCandidateVisits(responseId: string, search?: string) {
  await requireCapability("psg.workspace");
  if (!ids(responseId)) return [];
  return getDb().transaction((tx) => store.candidateVisits(tx, responseId, search?.slice(0, 100)));
}

export async function searchShopVisits(shopId: string, query: string) {
  await requireCapability("psg.workspace");
  if (!ids(shopId)) return [];
  return getDb().transaction((tx) => store.searchVisits(tx, shopId, query.slice(0, 100)));
}

export async function enterPaperResponse(input: store.PaperInput) {
  const actor = await user("response.paper_entry");
  if (!ids(input.shopId, input.visitId)) throw new store.StaffResponseError("not_found", "Choose a shop.");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(input.requestKey)) throw new store.StaffResponseError("invalid", "Reload the page and try again.");
  return getDb().transaction((tx) => store.submitPaper(tx, actor, input));
}

export async function matchResponseToVisit(responseId: string, matchRevision: number, visitId: string, evidence: string) {
  const actor = await user("match.manage");
  if (!ids(responseId, visitId)) throw notFound();
  return getDb().transaction((tx) => store.matchToVisit(tx, actor, responseId, matchRevision, visitId, evidence.slice(0, 1000)));
}

export async function recordMatchUnresolved(responseId: string, matchRevision: number, note: string) {
  const actor = await user("match.manage");
  if (!ids(responseId)) throw notFound();
  return getDb().transaction((tx) => store.recordUnresolved(tx, actor, responseId, matchRevision, note.slice(0, 1000)));
}

export async function confirmResponseShop(responseId: string, matchRevision: number, shopId: string, evidence: string) {
  const actor = await user("match.manage");
  if (!ids(responseId, shopId)) throw notFound();
  return getDb().transaction((tx) => store.confirmShop(tx, actor, responseId, matchRevision, shopId, evidence.slice(0, 1000)));
}

export async function resolveDuplicateResponse(responseId: string, matchRevision: number, disposition: "keep_original" | "promote", note: string) {
  const actor = await user("match.manage");
  if (!ids(responseId) || !["keep_original", "promote"].includes(disposition)) throw notFound();
  return getDb().transaction((tx) => store.resolveDuplicate(tx, actor, responseId, matchRevision, disposition, note.slice(0, 1000)));
}

export async function correctSubmittedResponse(responseId: string, expectedRevision: number, answers: unknown, reason: string) {
  const actor = await user("response.correct");
  if (!ids(responseId)) throw notFound();
  return getDb().transaction((tx) => store.correctResponse(tx, actor, responseId, expectedRevision, answers, reason.slice(0, 1000)));
}

export async function getPaperFormContext(shopId: string, visitId: string | null) {
  await requireCapability("response.paper_entry");
  if (!ids(shopId, visitId)) return null;
  return getDb().transaction(async (tx) => {
    try {
      return await store.paperFormContext(tx, shopId, visitId);
    } catch (error) {
      if (error instanceof store.StaffResponseError) return null;
      throw error;
    }
  });
}
