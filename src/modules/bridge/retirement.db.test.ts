/**
 * Database tests for bridge retirement (SR-47, AT-47). Every test rolls back.
 * They assume the development database has no other open bridge writes or
 * outstanding production suppression changes, which the suite checks first.
 */
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("bridge retirement", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { bridgeDependency, bridgeEvent, bridgeRetirement, suppressionAction, user } = await import("@/db/schema");
  const store = await import("./store");
  const retirement = await import("./retirement");
  type Tx = import("@/db/client").Tx;

  class Rollback extends Error {}
  const unique = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  async function inRollback(body: (tx: Tx) => Promise<void>) {
    try {
      await getDb().transaction(async (tx) => {
        await body(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  async function dbError(tx: Tx, write: (sp: Tx) => Promise<unknown>): Promise<string> {
    try {
      await tx.transaction(async (sp) => {
        await write(sp);
      });
    } catch (error) {
      const e = error as { message?: string; cause?: { message?: string } };
      return e.cause?.message ?? e.message ?? String(error);
    }
    return "no error";
  }

  async function admin(tx: Tx) {
    const id = `retire-${unique()}`;
    await tx.insert(user).values({ id, name: "Retire Admin", email: `${id}@psg.test` });
    return { type: "user" as const, userId: id };
  }

  afterAll(async () => {
    await getPool().end();
  });

  /** Other tests and browser runs leave rows in the development database; clear their effect inside this rolled-back transaction. */
  async function cleanSlate(tx: Tx) {
    await tx.update(bridgeDependency).set({ status: "retired", outcome: "Cleared for this test" });
    await tx.update(bridgeEvent).set({ state: "superseded", leaseOwner: null, leaseUntil: null }).where(inArray(bridgeEvent.state, ["pending", "retrying", "failed", "conflict"]));
    await tx.update(suppressionAction).set({ status: "acknowledged", acknowledgedAt: new Date(), result: "not_needed", evidence: "Cleared for this test" }).where(eq(suppressionAction.status, "outstanding"));
  }

  it("retires only when every dependency is dealt with and nothing is left waiting (AT-47)", () =>
    inRollback(async (tx) => {
      const a = await admin(tx);
      await cleanSlate(tx);
      const existing = (await retirement.listDependencies(tx)).length;
      if (existing === 0) expect(await retirement.retirementBlockers(tx)).toEqual([expect.stringMatching(/^List every FileMaker report/)]);
      else expect(await retirement.retirementBlockers(tx)).toEqual([]);
      const report = await retirement.addDependency(tx, a, "Monthly shop survey report", "Survey results");
      const mailRun = await retirement.addDependency(tx, a, "Routine mail run", "Suppression decisions");
      await expect(retirement.addDependency(tx, a, "Monthly shop survey report", "Survey results")).rejects.toMatchObject({ kind: "conflict" });
      expect(await retirement.retirementBlockers(tx)).toEqual(["Still in use: Monthly shop survey report.", "Still in use: Routine mail run."]);
      await expect(retirement.signRetirement(tx, a, "Pat (FileMaker owner)", "Everything reconciled against counts")).rejects.toMatchObject({ kind: "invalid" });

      // A failed bridge write would be left without an owner: it blocks too.
      const [event] = await tx
        .insert(bridgeEvent)
        .values({ entityType: "response", entityId: "00000000-0000-4000-8000-000000000001", entityVersion: 1000, payload: {}, payloadHash: "x", state: "failed", lastError: "FileMaker is not reachable" })
        .returning();

      await expect(retirement.setDependencyStatus(tx, a, report.id, "replaced", "")).rejects.toMatchObject({ kind: "invalid" });
      await retirement.setDependencyStatus(tx, a, report.id, "replaced", "Hub dashboard and export");
      await retirement.setDependencyStatus(tx, a, mailRun.id, "retired", "Mail runs now read Hub suppression data");
      expect(await retirement.retirementBlockers(tx)).toEqual([expect.stringMatching(/^1 bridge write is still waiting, failed or in conflict/)]);

      await store.retryEvent(tx, a, event.id);
      await tx.update(bridgeEvent).set({ state: "confirmed", confirmedAt: new Date() }).where(eq(bridgeEvent.id, event.id));
      expect(await retirement.retirementBlockers(tx)).toEqual([]);

      // Signing records the evidence and switches writes off.
      for (const gate of ["field_map", "alert_exclusion", "sandbox_test", "writes_enabled"]) await store.confirmGate(tx, a, gate, `Checked ${gate} with the FileMaker owner`);
      const record = await retirement.signRetirement(tx, a, "Pat (FileMaker owner)", "Counts reconciled with FileMaker on 28 Sep");
      expect(record.dependencies).toEqual(
        expect.arrayContaining([
          { name: "Monthly shop survey report", uses: "Survey results", status: "replaced", outcome: "Hub dashboard and export" },
          { name: "Routine mail run", uses: "Suppression decisions", status: "retired", outcome: "Mail runs now read Hub suppression data" },
        ]),
      );
      expect((record.dependencies as unknown[]).length).toBe(existing + 2);
      expect((await store.confirmedGates(tx)).has("writes_enabled")).toBe(false);
      expect([...(await store.confirmedGates(tx))].sort()).toEqual(["alert_exclusion", "field_map", "sandbox_test"]);

      // The record and the inventory are kept as history.
      expect(await dbError(tx, (sp) => sp.update(bridgeRetirement).set({ note: "Edited" }).where(eq(bridgeRetirement.id, record.id)))).toMatch(/append-only/);
      expect(await dbError(tx, (sp) => sp.delete(bridgeDependency).where(eq(bridgeDependency.id, report.id)))).toMatch(/cannot be deleted/);
      expect((await retirement.listRetirements(tx))[0]).toMatchObject({ by: "Retire Admin" });
    }));
});
