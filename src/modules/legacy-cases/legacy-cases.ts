import "server-only";
import { getDb } from "@/db/client";
import { loadPage } from "@/lib/pagination";
import { requireCapability } from "@/modules/access/principal";
import * as store from "./store";

/**
 * Authorized entry points for legacy case handoff (SR-46). Every PSG role can
 * see the cases and add notes; taking a case over and resolving it need
 * case.resolve, the same people who resolve new-system cases (SR-34).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (id: string) => {
  if (!UUID_RE.test(id)) throw new store.LegacyCaseError("not_found", "This case no longer exists.");
};
const as = (userId: string) => ({ type: "user" as const, userId });

export async function listLegacyCases(view: store.LegacyView, page: number) {
  await requireCapability("psg.workspace");
  return getDb().transaction(async (tx) => {
    const counts = await store.legacyCaseCounts(tx);
    const list = await loadPage(page, async () => counts[view], (offset, size) => store.listLegacyCases(tx, view, offset, size));
    return { list, counts };
  });
}

export async function getLegacyCase(caseId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(caseId)) return null;
  return getDb().transaction((tx) => store.getLegacyCase(tx, caseId));
}

export async function handOffLegacyCase(caseId: string, revision: number, note: string) {
  const { principal } = await requireCapability("case.resolve");
  requireId(caseId);
  return getDb().transaction((tx) => store.handOff(tx, as(principal.userId), caseId, revision, note.slice(0, 4000)));
}

export async function addLegacyCaseNote(caseId: string, body: string) {
  const { principal } = await requireCapability("psg.workspace");
  requireId(caseId);
  return getDb().transaction((tx) => store.addNote(tx, as(principal.userId), caseId, body.slice(0, 6000)));
}

export async function resolveLegacyCase(caseId: string, revision: number, outcome: string, note: string) {
  const { principal } = await requireCapability("case.resolve");
  requireId(caseId);
  return getDb().transaction((tx) => store.resolve(tx, as(principal.userId), caseId, revision, outcome, note.slice(0, 6000)));
}
