import "server-only";
import { getDb } from "@/db/client";
import { loadPage } from "@/lib/pagination";
import { requireCapability } from "@/modules/access/principal";
import * as store from "./store";

/** Authorized PSG entry points for email reconciliation and manual opt-outs (SR-23, SR-25). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listEmailProblems(page: number) {
  await requireCapability("operations.view");
  return getDb().transaction((tx) => loadPage(page, () => store.countProblems(tx), (offset, size) => store.listProblems(tx, offset, size)));
}

export async function resolveEmailProblem(intentId: string, resolution: store.Resolution, note: string) {
  const { principal } = await requireCapability("import.manage");
  if (!UUID_RE.test(intentId)) throw new store.LedgerError("not_found", "This email no longer exists.");
  if (!["release", "confirm_sent", "confirm_not_sent", "retry"].includes(resolution)) throw new store.LedgerError("invalid", "Choose an action.");
  return getDb().transaction((tx) => store.resolveProblem(tx, { type: "user", userId: principal.userId }, intentId, resolution, note.slice(0, 1000), new Date()));
}

/** PSG records an opt-out the customer asked for by phone or in person. */
export async function recordOptOutForInvitation(invitationId: string) {
  const { principal } = await requireCapability("import.manage");
  if (!UUID_RE.test(invitationId)) throw new store.LedgerError("not_found", "This invitation no longer exists.");
  const result = await getDb().transaction((tx) => store.recordOptOut(tx, { type: "user", userId: principal.userId }, invitationId, "psg_recorded", new Date()));
  if (!result.recorded) throw new store.LedgerError("invalid", "This visit has no email address to opt out.");
}
