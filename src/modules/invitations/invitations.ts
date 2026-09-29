import "server-only";
import { getDb } from "@/db/client";
import { requireCapability } from "@/modules/access/principal";
import * as store from "./store";

/** Authorized entry points for imported invitations. Explicit sends are PSG-only (SR-11). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireIds(...ids: string[]) {
  if (!ids.every((id) => UUID_RE.test(id))) throw new store.InvitationError("not_found", "This invitation no longer exists.");
}

export async function listInvitationQueue(shopId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(shopId)) return [];
  return getDb().transaction((tx) => store.listQueue(tx, shopId));
}

export async function sendSelectedInvitations(shopId: string, items: { id: string; revision: number }[]) {
  const { principal } = await requireCapability("import.manage");
  requireIds(shopId, ...items.map((i) => i.id));
  return getDb().transaction((tx) => store.sendInvitations(tx, { type: "user", userId: principal.userId }, shopId, items));
}

export async function correctInvitationContact(shopId: string, id: string, expectedRevision: number, input: { email: string; deliveredOn: string }) {
  const { principal } = await requireCapability("import.manage");
  requireIds(shopId, id);
  return getDb().transaction((tx) => store.correctInvitation(tx, { type: "user", userId: principal.userId }, shopId, id, expectedRevision, input));
}

export async function issuePrintableLink(shopId: string, id: string) {
  const { principal } = await requireCapability("import.manage");
  requireIds(shopId, id);
  return getDb().transaction((tx) => store.issuePrintableLink(tx, { type: "user", userId: principal.userId }, shopId, id));
}
