import "server-only";
import { getDb } from "@/db/client";
import { requireCapability } from "@/modules/access/principal";
import * as store from "./store";

/**
 * PSG-only test links for internal end-to-end testing (SR-03, SR-37). They are
 * always test invitations: they never contact a customer or count in reports.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createTestLink(input: { shopId: string; instrumentVersionId: string; lifetimeDays: number }) {
  const { principal } = await requireCapability("instrument.manage");
  if (!UUID_RE.test(input.shopId) || !UUID_RE.test(input.instrumentVersionId)) throw new store.ResponseConflictError("Choose a shop and a published version");
  if (!Number.isInteger(input.lifetimeDays) || input.lifetimeDays < 1 || input.lifetimeDays > 365) {
    throw new store.ResponseConflictError("Link lifetime must be between 1 and 365 days");
  }
  return getDb().transaction((tx) => store.createTestInvitation(tx, { type: "user", userId: principal.userId }, input));
}

export async function listTestLinks(instrumentVersionId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(instrumentVersionId)) return [];
  return getDb().transaction((tx) => store.listTestInvitations(tx, instrumentVersionId));
}

/** A submitted test response for PSG review. Live responses get tenant-scoped detail pages with the dashboard (SR-27). */
export async function getTestResponse(responseId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(responseId)) return null;
  const detail = await getDb().transaction((tx) => store.getResponseDetail(tx, responseId));
  return detail?.isTest ? detail : null;
}
