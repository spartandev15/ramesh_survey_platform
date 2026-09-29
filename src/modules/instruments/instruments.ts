import "server-only";
import { getDb } from "@/db/client";
import { requireCapability } from "@/modules/access/principal";
import { emptyDefinition } from "./definition";
import * as store from "./store";
import type { InstrumentInput } from "./validation";

/**
 * Authorized instrument operations for the signed-in user. PSG publishes;
 * shops only request changes (SR-15), so every operation here is PSG-only.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(id: string): string {
  if (!UUID_RE.test(id)) throw new store.InstrumentNotFoundError();
  return id;
}

async function actingUser(capability: "psg.workspace" | "instrument.manage"): Promise<store.Actor> {
  const { principal } = await requireCapability(capability);
  return { type: "user", userId: principal.userId };
}

export async function listInstruments() {
  await actingUser("psg.workspace");
  return getDb().transaction((tx) => store.listInstruments(tx));
}

export async function getInstrument(instrumentId: string) {
  await actingUser("psg.workspace");
  const id = requireId(instrumentId);
  return getDb().transaction((tx) => store.findInstrument(tx, id));
}

export async function createInstrument(input: InstrumentInput) {
  const actor = await actingUser("instrument.manage");
  return getDb().transaction((tx) => store.insertInstrument(tx, actor, input, emptyDefinition()));
}

/** The shop's own questions survey, created on first use (SR-45). PSG controls it; shops only request changes. */
export async function openShopAddition(shopId: string) {
  const actor = await actingUser("instrument.manage");
  const id = requireId(shopId);
  return getDb().transaction((tx) => store.createShopAddition(tx, actor, id));
}

export async function saveDraft(versionId: string, expectedRevision: number, definition: unknown, sourceNote?: string | null) {
  const actor = await actingUser("instrument.manage");
  const id = requireId(versionId);
  return getDb().transaction((tx) => store.saveDraft(tx, actor, id, expectedRevision, definition, sourceNote));
}

export async function publishVersion(versionId: string, expectedRevision: number, options: { isTest: boolean; sourceNote?: string | null }) {
  const actor = await actingUser("instrument.manage");
  const id = requireId(versionId);
  return getDb().transaction((tx) => store.publishVersion(tx, actor, id, expectedRevision, options));
}

export async function createDraftFrom(versionId: string) {
  const actor = await actingUser("instrument.manage");
  const id = requireId(versionId);
  return getDb().transaction((tx) => store.createDraftFrom(tx, actor, id));
}

export async function duplicateInstrument(fromVersionId: string, input: InstrumentInput) {
  const actor = await actingUser("instrument.manage");
  const id = requireId(fromVersionId);
  return getDb().transaction((tx) => store.duplicateInstrument(tx, actor, id, input));
}

export async function discardDraft(versionId: string, expectedRevision: number) {
  const actor = await actingUser("instrument.manage");
  const id = requireId(versionId);
  return getDb().transaction((tx) => store.discardDraft(tx, actor, id, expectedRevision));
}
