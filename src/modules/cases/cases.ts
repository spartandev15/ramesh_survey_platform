import "server-only";
import { getDb } from "@/db/client";
import { canParticipateInShopCase } from "@/modules/access/capabilities";
import { NotFoundError } from "@/modules/access/errors";
import { requireCapability, requireShopRead, requireUser } from "@/modules/access/principal";
import { loadPage } from "@/lib/pagination";
import * as store from "./store";

/**
 * Authorized entry points for alerts, follow-up and suppression (SR-32..SR-36).
 * PSG reviews, approves and resolves; shop users add notes and request
 * closure on their own shop's approved cases only (SR-01, SR-34).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (...ids: string[]) => {
  if (!ids.every((id) => UUID_RE.test(id))) throw new store.CaseError("not_found", "This case no longer exists.");
};
/** PSG lists show ten rows a page, so a page needs little scrolling. */
const LIST_SIZE = 10;
const as = (userId: string) => ({ type: "user" as const, userId });

// PSG ---------------------------------------------------------------------

export async function listCases(view: store.CaseView, page: number, search: store.CaseSearch = {}) {
  await requireCapability("psg.workspace");
  if (search.shopId && !UUID_RE.test(search.shopId)) search = { ...search, shopId: undefined };
  return getDb().transaction((tx) => loadPage(page, () => store.countCases(tx, view, search), (offset, size) => store.listCases(tx, view, offset, size, search), LIST_SIZE));
}

export async function alertReasonCounts(view: store.CaseView) {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => store.alertReasonCounts(tx, view));
}

export async function caseCounts() {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => store.caseCounts(tx));
}

export async function getCase(caseId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(caseId)) return null;
  return getDb().transaction((tx) => store.getCase(tx, caseId));
}

export async function approveAndSend(caseId: string, revision: number, recipients: string[], note: string) {
  const { principal } = await requireCapability("alert.review");
  requireId(caseId);
  return getDb().transaction((tx) => store.approveAndSend(tx, as(principal.userId), caseId, revision, recipients, note.slice(0, 2000)));
}

export async function dismissCase(caseId: string, revision: number, note: string) {
  const { principal } = await requireCapability("alert.review");
  requireId(caseId);
  return getDb().transaction((tx) => store.dismissCase(tx, as(principal.userId), caseId, revision, note.slice(0, 2000)));
}

export async function addPsgNote(caseId: string, body: string, visibility: "shop" | "internal") {
  const { principal } = await requireCapability("psg.workspace");
  requireId(caseId);
  return getDb().transaction((tx) => store.addNote(tx, as(principal.userId), caseId, { body, visibility: visibility === "internal" ? "internal" : "shop", authorKind: "psg" }));
}

export async function resolveCase(caseId: string, revision: number, outcome: store.ResolutionOutcome, note: string) {
  const { principal } = await requireCapability("case.resolve");
  requireId(caseId);
  return getDb().transaction((tx) => store.resolveCase(tx, as(principal.userId), caseId, revision, outcome, note.slice(0, 2000)));
}

export async function listSuppressions(status: "outstanding" | "acknowledged", page: number, search: store.SuppressionSearch = {}) {
  await requireCapability("psg.workspace");
  if (search.shopId && !UUID_RE.test(search.shopId)) search = { ...search, shopId: undefined };
  return getDb().transaction((tx) => loadPage(page, () => store.countSuppressions(tx, status, search), (offset, size) => store.listSuppressions(tx, status, { offset, size }, search), LIST_SIZE));
}

export async function suppressionStats() {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => store.suppressionStats(tx));
}

export async function acknowledgeSuppression(actionId: string, revision: number, result: store.SuppressionResult, evidence: string) {
  const { principal } = await requireCapability("suppression.acknowledge");
  requireId(actionId);
  return getDb().transaction((tx) => store.acknowledgeSuppression(tx, as(principal.userId), actionId, revision, result, evidence.slice(0, 2000)));
}

export async function caseForResponse(responseId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(responseId)) return null;
  return getDb().transaction((tx) => store.caseForResponse(tx, responseId));
}

// Shop ---------------------------------------------------------------------

/** The approved follow-up case of one of this shop's responses, if any. */
export async function shopCaseForResponse(shopId: string, responseId: string) {
  await requireShopRead(shopId);
  if (!UUID_RE.test(responseId)) return null;
  const c = await getDb().transaction((tx) => store.caseForResponse(tx, responseId));
  return c && c.shopId === shopId && c.status === "approved" ? c : null;
}

export async function listShopCases(shopId: string, page: number) {
  await requireShopRead(shopId);
  return getDb().transaction((tx) => loadPage(page, () => store.countShopCases(tx, shopId), (offset, size) => store.listShopCases(tx, shopId, offset, size)));
}

export async function getShopCase(shopId: string, caseId: string) {
  await requireShopRead(shopId);
  if (!UUID_RE.test(caseId)) return null;
  return getDb().transaction((tx) => store.getShopCase(tx, shopId, caseId));
}

/** The case must be an approved case of a shop this user belongs to; anything else is "not found" (AT-01). */
async function shopActor(shopId: string, caseId: string) {
  const { principal } = await requireUser();
  requireId(shopId, caseId);
  if (!canParticipateInShopCase(principal, shopId)) throw new NotFoundError();
  const found = await getDb().transaction((tx) => store.getShopCase(tx, shopId, caseId));
  if (!found) throw new NotFoundError();
  return as(principal.userId);
}

export async function addShopNote(shopId: string, caseId: string, body: string) {
  const actor = await shopActor(shopId, caseId);
  return getDb().transaction((tx) => store.addNote(tx, actor, caseId, { body, visibility: "shop", authorKind: "shop" }));
}

export async function requestShopClosure(shopId: string, caseId: string, revision: number, note: string) {
  const actor = await shopActor(shopId, caseId);
  return getDb().transaction((tx) => store.requestClosure(tx, actor, caseId, revision, note.slice(0, 2000)));
}
