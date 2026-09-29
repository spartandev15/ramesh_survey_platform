import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { bridgeDependency, bridgeEvent, bridgeGate, bridgeRetirement, suppressionAction, user } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { BridgeError, type Actor } from "./store";

/**
 * Bridge retirement (SR-47): only once every FileMaker dependency on it is
 * replaced or retired, and nothing is left waiting that someone would have to
 * pick up. Signing records the evidence and switches writes off; nothing is
 * deleted, so history stays traceable. Runs in the caller's transaction and
 * does NOT authorize.
 */

export const DEPENDENCY_STATUS = { in_use: "Still in use", replaced: "Replaced", retired: "No longer needed" } as const;
export type DependencyStatus = keyof typeof DEPENDENCY_STATUS;

export async function listDependencies(tx: Tx) {
  return tx.select({ d: bridgeDependency, by: user.name }).from(bridgeDependency).leftJoin(user, eq(user.id, bridgeDependency.updatedBy)).orderBy(asc(bridgeDependency.createdAt));
}

export async function addDependency(tx: Tx, actor: Actor, name: string, uses: string, now = new Date()) {
  const n = name.trim();
  const u = uses.trim();
  if (n.length < 3 || u.length < 3) throw new BridgeError("invalid", "Name the dependency and what it uses from the bridge.");
  const [created] = await tx.insert(bridgeDependency).values({ name: n.slice(0, 200), uses: u.slice(0, 500), updatedBy: actor.userId, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
  if (!created) throw new BridgeError("conflict", "That dependency is already listed.");
  await recordAudit({ actorType: "user", actorUserId: actor.userId, action: "bridge.dependency_added", subjectType: "bridge_dependency", subjectId: created.id, after: { name: created.name, uses: created.uses } }, tx);
  return created;
}

/** Mark a dependency replaced (by what) or no longer needed (why), or back in use. */
export async function setDependencyStatus(tx: Tx, actor: Actor, id: string, status: string, outcome: string, now = new Date()) {
  if (!(status in DEPENDENCY_STATUS)) throw new BridgeError("invalid", "Choose a state.");
  const text = outcome.trim();
  if (status !== "in_use" && text.length < 5) throw new BridgeError("invalid", status === "replaced" ? "Say what replaced it." : "Say why it is no longer needed.");
  const [before] = await tx.select().from(bridgeDependency).where(eq(bridgeDependency.id, id)).for("update");
  if (!before) throw new BridgeError("not_found", "This dependency no longer exists.");
  await tx
    .update(bridgeDependency)
    .set({ status, outcome: status === "in_use" ? null : text.slice(0, 1000), updatedBy: actor.userId, updatedAt: now })
    .where(eq(bridgeDependency.id, id));
  await recordAudit(
    { actorType: "user", actorUserId: actor.userId, action: "bridge.dependency_updated", subjectType: "bridge_dependency", subjectId: id, before: { status: before.status, outcome: before.outcome }, after: { status, outcome: text || null } },
    tx,
  );
}

/** Why the bridge cannot be retired yet; empty when it can (AT-47). */
export async function retirementBlockers(tx: Tx): Promise<string[]> {
  const blockers: string[] = [];
  const deps = await tx.select({ name: bridgeDependency.name, status: bridgeDependency.status }).from(bridgeDependency);
  if (deps.length === 0) blockers.push("List every FileMaker report, mail run or screen that still uses the bridge (or confirm none by listing and retiring them).");
  for (const d of deps.filter((x) => x.status === "in_use")) blockers.push(`Still in use: ${d.name}.`);
  const [open] = await tx.select({ n: count() }).from(bridgeEvent).where(inArray(bridgeEvent.state, ["pending", "retrying", "failed", "conflict"]));
  if (open.n > 0) blockers.push(`${open.n} bridge write${open.n === 1 ? " is" : "s are"} still waiting, failed or in conflict. Settle them first, so nothing is left without an owner.`);
  const [outstanding] = await tx.select({ n: count() }).from(suppressionAction).where(and(eq(suppressionAction.status, "outstanding"), eq(suppressionAction.isTest, false)));
  if (outstanding.n > 0) blockers.push(`${outstanding.n} suppression change${outstanding.n === 1 ? " is" : "s are"} still outstanding in the Suppression queue.`);
  return blockers;
}

/**
 * Sign the retirement: the named FileMaker owner agreed, every dependency is
 * dealt with, nothing is waiting. Records the evidence, then switches writes
 * off. The outbox, mappings and audit history all stay.
 */
export async function signRetirement(tx: Tx, actor: Actor, fileMakerOwner: string, note: string, now = new Date()) {
  const owner = fileMakerOwner.trim();
  const text = note.trim();
  if (owner.length < 2) throw new BridgeError("invalid", "Name the FileMaker owner who agreed.");
  if (text.length < 10) throw new BridgeError("invalid", "Record what was reconciled before retiring.");
  // Lock the inventory so it cannot change between the check and the record.
  const deps = await tx.select().from(bridgeDependency).orderBy(asc(bridgeDependency.createdAt)).for("update");
  const blockers = await retirementBlockers(tx);
  if (blockers.length > 0) throw new BridgeError("invalid", `Not ready to retire: ${blockers.join(" ")}`);
  const [record] = await tx
    .insert(bridgeRetirement)
    .values({ signedBy: actor.userId, fileMakerOwner: owner.slice(0, 200), note: text.slice(0, 4000), dependencies: deps.map((d) => ({ name: d.name, uses: d.uses, status: d.status, outcome: d.outcome })), signedAt: now })
    .returning();
  const removed = await tx.delete(bridgeGate).where(eq(bridgeGate.item, "writes_enabled")).returning({ item: bridgeGate.item });
  await recordAudit(
    { actorType: "user", actorUserId: actor.userId, action: "bridge.retired", subjectType: "bridge_retirement", subjectId: String(record.id), after: { fileMakerOwner: record.fileMakerOwner, dependencies: deps.length, writesSwitchedOff: removed.length > 0 } },
    tx,
  );
  return record;
}

export async function listRetirements(tx: Tx) {
  return tx.select({ r: bridgeRetirement, by: user.name }).from(bridgeRetirement).innerJoin(user, eq(user.id, bridgeRetirement.signedBy)).orderBy(desc(bridgeRetirement.signedAt));
}
