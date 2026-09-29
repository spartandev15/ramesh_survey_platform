import "server-only";
import { getDb } from "@/db/client";
import { loadPage } from "@/lib/pagination";
import { requireCapability } from "@/modules/access/principal";
import { configuredAdapter } from "./adapter";
import { readiness } from "./policy";
import * as retirement from "./retirement";
import * as store from "./store";

/**
 * Authorized entry points for the FileMaker bridge (SR-41..SR-43). Every PSG
 * role sees its state; admins record the go-live checks; admins and
 * operators settle failed or conflicting writes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (id: string) => {
  if (!UUID_RE.test(id)) throw new store.BridgeError("not_found", "This item no longer exists.");
};
const as = (userId: string) => ({ type: "user" as const, userId });

export async function getBridgeStatus(problemPage = 1) {
  await requireCapability("psg.workspace");
  const adapter = configuredAdapter();
  return getDb().transaction(async (tx) => {
    const gates = await store.listGates(tx);
    const counts = await store.stateCounts(tx);
    return {
      connection: adapter?.name ?? null,
      readiness: readiness(adapter !== null, new Set((await store.confirmedGates(tx)).values())),
      gates,
      counts,
      problems: await loadPage(problemPage, async () => counts.failed + counts.conflict + counts.retrying, (offset, size) => store.listProblems(tx, offset, size)),
      lag: await store.lag(tx),
    };
  });
}

/** What FileMaker holds for one Hub response, stated only as far as a read-back proves it (SR-35, AT-43). */
export async function responseBridgeState(responseId: string) {
  await requireCapability("psg.workspace");
  if (!configuredAdapter() || !UUID_RE.test(responseId)) return null;
  return getDb().transaction((tx) => store.latestState(tx, "response", responseId));
}

/** Dependency inventory, what still blocks retirement, and signed retirements (SR-47). */
export async function getRetirementStatus() {
  await requireCapability("psg.workspace");
  return getDb().transaction(async (tx) => ({
    dependencies: await retirement.listDependencies(tx),
    blockers: await retirement.retirementBlockers(tx),
    signed: await retirement.listRetirements(tx),
  }));
}

export async function addBridgeDependency(name: string, uses: string) {
  const { principal } = await requireCapability("shop.manage");
  return getDb().transaction((tx) => retirement.addDependency(tx, as(principal.userId), name.slice(0, 400), uses.slice(0, 1000)));
}

export async function setBridgeDependencyStatus(id: string, status: string, outcome: string) {
  const { principal } = await requireCapability("shop.manage");
  requireId(id);
  return getDb().transaction((tx) => retirement.setDependencyStatus(tx, as(principal.userId), id, status, outcome.slice(0, 2000)));
}

export async function signBridgeRetirement(fileMakerOwner: string, note: string) {
  const { principal } = await requireCapability("shop.manage");
  return getDb().transaction((tx) => retirement.signRetirement(tx, as(principal.userId), fileMakerOwner.slice(0, 400), note.slice(0, 8000)));
}

export async function confirmBridgeGate(item: string, note: string) {
  const { principal } = await requireCapability("shop.manage");
  return getDb().transaction((tx) => store.confirmGate(tx, as(principal.userId), item, note.slice(0, 4000)));
}

export async function withdrawBridgeGate(item: string) {
  const { principal } = await requireCapability("shop.manage");
  return getDb().transaction((tx) => store.withdrawGate(tx, as(principal.userId), item));
}

export async function retryBridgeEvent(eventId: string) {
  const { principal } = await requireCapability("operations.manage");
  requireId(eventId);
  return getDb().transaction((tx) => store.retryEvent(tx, as(principal.userId), eventId));
}

export async function keepHubVersion(eventId: string, note: string) {
  const { principal } = await requireCapability("operations.manage");
  requireId(eventId);
  return getDb().transaction((tx) => store.keepHubVersion(tx, as(principal.userId), eventId, note.slice(0, 4000)));
}
