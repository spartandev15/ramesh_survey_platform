/**
 * Database tests for the FileMaker bridge (SR-41..SR-43, AT-41, AT-43) with
 * an in-memory FileMaker. Every test rolls back.
 */
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("FileMaker bridge", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { alertCase, bridgeEvent, bridgeMapping, invitation, repairVisit, shop, shopSurveySettings, suppressionAction, surveyResponse, user } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const imports = await import("@/modules/imports/store");
  const invitations = await import("@/modules/invitations/store");
  const responses = await import("@/modules/responses/store");
  const staff = await import("@/modules/responses/staff-store");
  const { MemoryBridgeAdapter } = await import("./adapter");
  const { MAX_ATTEMPTS } = await import("./policy");
  const store = await import("./store");
  const { runBridgeCycle } = await import("./sync");
  type Tx = import("@/db/client").Tx;

  const system = { type: "system" } as const;
  class Rollback extends Error {}
  const unique = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const minutes = (n: number) => n * 60 * 1000;

  /** Run the body in a transaction that always rolls back; a real failure is reported as itself. */
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

  const low = { overall_rating: 1, ready_on_time: "no", delay_detail: "Late", service_aspects: { communication: "poor", quality: "poor", cleanliness: "poor" }, recommend_score: 1 };

  /** A production response with its alert case and suppression change, as they reach the bridge. */
  async function productionResponse(tx: Tx) {
    const [s] = await tx.insert(shop).values({ name: `Bridge Shop ${unique()}`, publicSlug: `bridge-${unique().replace("_", "-")}` }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    const { draft } = await instruments.insertInstrument(tx, system, { key: `bridge_${unique()}`, name: "Core" }, demoDefinition);
    const version = await instruments.publishVersion(tx, system, draft.id, draft.revision, { isTest: false, sourceNote: "Approved export" });
    const saved = await settings.updateSettings(
      tx,
      system,
      s.id,
      1,
      settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-01-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: [], logoUrl: "", brandColor: "" }),
    );
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: new Date() }).where(eq(shopSurveySettings.shopId, s.id));
    await settings.changeMode(tx, system, s.id, saved.revision, "live");
    const batch = await imports.createBatch(tx, system, { shopId: s.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "b.csv", content: "RO,Last Name,Delivered On\nB1,Smith,2026-09-10" });
    await imports.commitBatch(tx, system, batch.id, batch.revision);
    const [inv] = await tx.select({ id: invitation.id }).from(invitation).innerJoin(repairVisit, eq(repairVisit.id, invitation.visitId)).where(and(eq(repairVisit.shopId, s.id), eq(repairVisit.sourceVisitKey, "B1")));
    const link = await invitations.issuePrintableLink(tx, system, s.id, inv.id);
    const submitted = await responses.submitResponse(tx, link.token, `k-${unique()}`, low);
    if (!submitted.ok) throw new Error("submit failed");
    const [c] = await tx.select({ id: alertCase.id }).from(alertCase).where(eq(alertCase.responseId, submitted.responseId));
    const actions = await tx.select({ id: suppressionAction.id }).from(suppressionAction).where(eq(suppressionAction.responseId, submitted.responseId));
    return { responseId: submitted.responseId, entityIds: [submitted.responseId, c.id, ...actions.map((a) => a.id)] };
  }

  async function admin(tx: Tx) {
    const id = `bridge-${unique()}`;
    await tx.insert(user).values({ id, name: "Bridge Admin", email: `${id}@psg.test` });
    return { type: "user" as const, userId: id };
  }

  async function enable(tx: Tx) {
    const a = await admin(tx);
    for (const gate of ["field_map", "alert_exclusion", "sandbox_test", "writes_enabled"]) await store.confirmGate(tx, a, gate, `Checked ${gate} with the FileMaker owner`);
    return a;
  }

  const cycle = (tx: Tx, adapter: InstanceType<typeof MemoryBridgeAdapter> | null, entityIds: string[], at: Date) =>
    runBridgeCycle(adapter, "w", { now: () => at, scope: { entityIds }, run: (fn) => fn(tx) });
  const events = (tx: Tx, entityIds: string[]) => tx.select().from(bridgeEvent).where(inArray(bridgeEvent.entityId, entityIds));

  afterAll(async () => {
    await getPool().end();
  });

  // AT-42 on the Hub side: nothing is written before the legacy-alert check is recorded, and every
  // record carries the "hub" marker FileMaker scripts use to skip alerts. The scripts themselves are checked in FileMaker.
  it("writes nothing until a FileMaker connection exists and every check is recorded (SR-42, AT-42)", () =>
    inRollback(async (tx) => {
      const { entityIds } = await productionResponse(tx);
      expect(await cycle(tx, null, entityIds, new Date())).toMatchObject({ enabled: false });
      const fm = new MemoryBridgeAdapter();
      expect(await cycle(tx, fm, entityIds, new Date())).toMatchObject({ enabled: false });
      expect(fm.writes).toBe(0);
      expect(await events(tx, entityIds)).toHaveLength(0);

      // The switch comes last, and withdrawing any check switches writes off again.
      const a = await admin(tx);
      await expect(store.confirmGate(tx, a, "writes_enabled", "Switch on please")).rejects.toMatchObject({ kind: "invalid" });
      for (const gate of ["field_map", "alert_exclusion", "sandbox_test", "writes_enabled"]) await store.confirmGate(tx, a, gate, `Checked ${gate} with the FileMaker owner`);
      await store.withdrawGate(tx, a, "alert_exclusion");
      expect([...(await store.confirmedGates(tx))].sort()).toEqual(["field_map", "sandbox_test"]);
    }));

  it("sends each Hub record once, marked as from Hub, and a replay changes nothing (AT-41, AT-42)", () =>
    inRollback(async (tx) => {
      const { entityIds } = await productionResponse(tx);
      await enable(tx);
      const fm = new MemoryBridgeAdapter();
      const first = await cycle(tx, fm, entityIds, new Date());
      expect(first).toMatchObject({ enabled: true, queued: entityIds.length, confirmed: entityIds.length, errors: 0 });
      expect(fm.records.size).toBe(entityIds.length);
      for (const { record } of fm.records.values()) expect(record.source_marker).toBe("hub");
      // Test data never goes: every record belongs to this production shop.
      expect((await events(tx, entityIds)).every((e) => e.state === "confirmed")).toBe(true);

      const replay = await cycle(tx, fm, entityIds, new Date());
      expect(replay).toMatchObject({ queued: 0, confirmed: 0 });
      expect(fm.records.size).toBe(entityIds.length);
      expect(await tx.select().from(bridgeMapping).then((m) => m.filter((x) => entityIds.includes(x.entityId)))).toHaveLength(entityIds.length);
    }));

  it("keeps waiting through a FileMaker outage and converges on one record per Hub record", () =>
    inRollback(async (tx) => {
      const { responseId, entityIds } = await productionResponse(tx);
      await enable(tx);
      const fm = new MemoryBridgeAdapter();
      fm.offline = true;
      let at = new Date();
      expect(await cycle(tx, fm, entityIds, at)).toMatchObject({ confirmed: 0, errors: entityIds.length });
      expect((await events(tx, entityIds)).every((e) => e.state === "retrying" && e.lastError === "FileMaker is not reachable")).toBe(true);

      // Hub keeps working meanwhile: a correction adds a newer version, which replaces the unsent one.
      const [rev] = await tx.select({ n: surveyResponse.matchRevision }).from(surveyResponse).where(eq(surveyResponse.id, responseId));
      expect(rev.n).toBeGreaterThan(0);
      await staff.correctResponse(tx, system, responseId, 1, { ...low, recommend_score: 3 }, "Customer phoned to correct the score");

      fm.offline = false;
      at = new Date(at.getTime() + minutes(90));
      const recovered = await cycle(tx, fm, entityIds, at);
      expect(recovered.errors).toBe(0);
      const responseEvents = (await events(tx, entityIds)).filter((e) => e.entityId === responseId);
      expect(responseEvents.map((e) => e.state).sort()).toEqual(["confirmed", "superseded"]);
      expect(fm.records.size).toBe(entityIds.length);
      const sent = [...fm.records.values()].find((r) => r.record.hub_id === responseId)!;
      expect((sent.record.answers as { recommend_score: number }).recommend_score).toBe(3);
    }));

  it("quarantines a change made in FileMaker and never lets it change Hub (AT-43)", () =>
    inRollback(async (tx) => {
      const { responseId, entityIds } = await productionResponse(tx);
      const a = await enable(tx);
      const fm = new MemoryBridgeAdapter();
      const at = new Date();
      await cycle(tx, fm, entityIds, at);
      const [mapping] = await tx.select().from(bridgeMapping).where(eq(bridgeMapping.entityId, responseId));
      fm.editInFileMaker(mapping.externalId, { match_status: "edited by hand in FileMaker" });

      await staff.correctResponse(tx, system, responseId, 1, { ...low, recommend_score: 4 }, "Customer phoned to correct the score");
      expect(await cycle(tx, fm, [responseId], at)).toMatchObject({ conflicts: 1, confirmed: 0 });
      const [conflict] = (await events(tx, [responseId])).filter((e) => e.state === "conflict");
      expect(conflict.lastError).toMatch(/changed outside Hub/);
      // FileMaker keeps its edit for now, and Hub's response is untouched by it.
      expect(fm.records.get(mapping.externalId)!.record.match_status).toBe("edited by hand in FileMaker");
      const [hub] = await tx.select({ status: surveyResponse.matchStatus }).from(surveyResponse).where(eq(surveyResponse.id, responseId));
      expect(hub.status).toBe("matched");

      // PSG reviews it and puts Hub's version back.
      await expect(store.keepHubVersion(tx, a, conflict.id, "ok")).rejects.toMatchObject({ kind: "invalid" });
      await store.keepHubVersion(tx, a, conflict.id, "FileMaker owner confirmed the edit was a mistake");
      expect(await cycle(tx, fm, [responseId], new Date(Date.now() + minutes(1)))).toMatchObject({ confirmed: 1 });
      expect(fm.records.get(mapping.externalId)!.record.match_status).toBe("matched");
    }));

  it("gives up after repeated failures and lets PSG retry the same write", () =>
    inRollback(async (tx) => {
      const { responseId } = await productionResponse(tx);
      const a = await enable(tx);
      const fm = new MemoryBridgeAdapter();
      fm.offline = true;
      let at = new Date();
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await cycle(tx, fm, [responseId], at);
        at = new Date(at.getTime() + minutes(61));
      }
      const [failed] = await events(tx, [responseId]);
      expect(failed.state).toBe("failed");
      expect(failed.lastError).toBe("FileMaker is not reachable");

      fm.offline = false;
      await store.retryEvent(tx, a, failed.id, at);
      expect(await cycle(tx, fm, [responseId], at)).toMatchObject({ confirmed: 1 });
      expect(fm.records.size).toBe(1);
    }));
});
