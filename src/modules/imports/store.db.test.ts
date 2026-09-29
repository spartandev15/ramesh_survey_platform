/**
 * Database tests for import, eligibility and explicit sending
 * (SR-03..SR-11; AT-03..AT-11). Every test rolls back except the concurrency
 * test, which must commit two real transactions and uses test-only data.
 */
import { and, count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("imports and invitations", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { emailIntent, invitation, legacySurveyLedger, repairVisit, shop, shopOptOut, shopSurveySettings, testRecipientAllowlist } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const store = await import("./store");
  const invitations = await import("@/modules/invitations/store");
  type Tx = import("@/db/client").Tx;

  const actor = { type: "system" } as const;
  class Rollback extends Error {}
  const unique = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  async function inRollback(body: (tx: Tx) => Promise<void>) {
    await expect(
      getDb().transaction(async (tx) => {
        await body(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  const HEADER = "RO #,First Name,Last Name,Email,Delivered On";
  const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

  async function publish(tx: Tx, isTest: boolean) {
    const { draft } = await instruments.insertInstrument(tx, actor, { key: `imp_${unique()}`, name: "Demo" }, demoDefinition);
    return instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest, sourceNote: isTest ? null : "Approved export, checksum abc" });
  }

  /** A production shop with a verified version, cutoff 2026-10-01 and confirmed legacy coverage. */
  async function productionShop(tx: Tx, mode: "test" | "live" = "live") {
    const [s] = await tx.insert(shop).values({ name: "Import Shop", publicSlug: `imp-${unique().replace("_", "-")}` }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    const version = await publish(tx, false);
    const input = settingsInputSchema.parse({
      instrumentVersionId: version.id,
      deliveryCutoff: "2026-10-01",
      timezone: "America/Chicago",
      reminderDelayDays: 7,
      linkLifetimeDays: 90,
      alertRecipients: [],
      logoUrl: "",
      brandColor: "",
    });
    let saved = await settings.updateSettings(tx, actor, s.id, 1, input);
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: new Date() }).where(eq(shopSurveySettings.shopId, s.id));
    if (mode === "live") saved = await settings.changeMode(tx, actor, s.id, saved.revision, "live");
    return { shop: s, version, revision: saved.revision };
  }

  async function importCsv(tx: Tx, shopId: string, content: string, options: { isTest?: boolean; kind?: "visits" | "legacy_ledger" } = {}) {
    const batch = await store.createBatch(tx, actor, { shopId, kind: options.kind ?? "visits", isTest: options.isTest ?? false, sourceSystem: "shop_documents", fileName: "test.csv", content });
    return store.commitBatch(tx, actor, batch.id, batch.revision);
  }

  const intentsFor = async (tx: Tx, shopId: string) =>
    (await tx.select({ n: count() }).from(emailIntent).innerJoin(invitation, eq(invitation.id, emailIntent.invitationId)).where(eq(invitation.shopId, shopId)))[0].n;

  afterAll(async () => {
    await getPool().end();
  });

  it("creates a customer, visit and one send for a new eligible record, with batch counts (AT-06)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await productionShop(tx);
      const batch = await importCsv(
        tx,
        s.id,
        csv("1001,Jo,Smith,jo@example.com,2026-10-02", "1002,Al,Lee,,2026-10-02", "1003,Bo,Kim,bo@example.com,2026-09-30", "1001,Jo,Smith,jo@example.com,2026-10-02"),
      );
      expect(batch.counts).toEqual({ created: 1, reused: 1, held: 2, excluded: 0, rejected: 0 });
      expect(await intentsFor(tx, s.id)).toBe(1);
      const [{ n: visits }] = await tx.select({ n: count() }).from(repairVisit).where(eq(repairVisit.shopId, s.id));
      expect(visits).toBe(3);
    }));

  it("reimporting the same visits reuses them and sends nothing more (SR-07)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await productionShop(tx);
      const content = csv("1001,Jo,Smith,jo@example.com,2026-10-02");
      await importCsv(tx, s.id, content);
      const again = await importCsv(tx, s.id, content);
      expect(again.counts).toMatchObject({ created: 0, reused: 1 });
      expect(await intentsFor(tx, s.id)).toBe(1);
    }));

  it("holds a reused visit ID with a different customer and treats a later visit separately (AT-07)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await productionShop(tx);
      await importCsv(tx, s.id, csv("1001,Jo,Smith,jo@example.com,2026-10-02"));
      const next = await importCsv(tx, s.id, csv("1001,Pat,Jones,pat@example.com,2026-10-05", "1002,Jo,Smith,jo@example.com,2026-11-20"));
      expect(next.counts).toMatchObject({ held: 1, created: 1 });
      expect(await intentsFor(tx, s.id)).toBe(2);
    }));

  it("concurrent imports of the same visit create one visit and one invitation (AT-07)", async () => {
    // Test-only data in an internal test shop; it commits so both transactions are real.
    const setup = await getDb().transaction(async (tx) => {
      const [s] = await tx.insert(shop).values({ name: "E2E Concurrency (internal test)", publicSlug: `conc-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      await settings.insertDefaultSettings(tx, s.id);
      const version = await publish(tx, true);
      await tx.update(shopSurveySettings).set({ instrumentVersionId: version.id }).where(eq(shopSurveySettings.shopId, s.id));
      const content = csv("5001,Jo,Smith,jo@example.com,2026-10-02");
      const a = await store.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: true, sourceSystem: "shop_documents", fileName: "a.csv", content });
      const b = await store.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: true, sourceSystem: "shop_documents", fileName: "b.csv", content });
      return { shopId: s.id, a, b };
    });
    const results = await Promise.all([setup.a, setup.b].map((batch) => getDb().transaction((tx) => store.commitBatch(tx, actor, batch.id, batch.revision))));
    const counts = results.map((r) => r.counts as Record<string, number>);
    expect(counts.map((c) => c.reused).sort()).toEqual([0, 1]);
    const [{ n: visits }] = await getDb().select({ n: count() }).from(repairVisit).where(eq(repairVisit.shopId, setup.shopId));
    const [{ n: invites }] = await getDb().select({ n: count() }).from(invitation).where(eq(invitation.shopId, setup.shopId));
    expect([visits, invites]).toEqual([1, 1]);
  });

  it("excludes legacy sent-only and completed visits and flags unknown coverage (AT-08)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await productionShop(tx);
      const ledger = await importCsv(tx, s.id, "RO,Sent,Completed\n2001,9/1/2026,\n2002,9/1/2026,9/3/2026\n,9/1/2026,", { kind: "legacy_ledger" });
      expect(ledger.counts).toMatchObject({ created: 2, rejected: 1 });
      const batch = await importCsv(tx, s.id, csv("2001,A,One,a@example.com,2026-10-02", "2002,B,Two,b@example.com,2026-10-02", "2003,C,Three,c@example.com,2026-10-02"));
      expect(batch.counts).toMatchObject({ excluded: 2, created: 1 });
      expect(await intentsFor(tx, s.id)).toBe(1);

      await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: null }).where(eq(shopSurveySettings.shopId, s.id));
      const unknown = await importCsv(tx, s.id, csv("2004,D,Four,d@example.com,2026-10-02"));
      expect(unknown.counts).toMatchObject({ held: 1 });
      // Legacy evidence is read-only.
      await expect(tx.transaction((inner) => inner.update(legacySurveyLedger).set({ responseRef: "x" }).where(eq(legacySurveyLedger.shopId, s.id)))).rejects.toThrow();
    }));

  it("imports a record without email with a printable link and no email job (AT-09)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await productionShop(tx);
      await importCsv(tx, s.id, csv("3001,Al,Lee,,2026-10-02"));
      const [row] = await invitations.listQueue(tx, s.id);
      expect(row.blockers).toEqual(["EMAIL_NEEDED"]);
      const link = await invitations.issuePrintableLink(tx, actor, s.id, row.id);
      expect(link.token).toHaveLength(43);
      expect(await intentsFor(tx, s.id)).toBe(0);
    }));

  it("never sends an undated record, even when imported today (AT-10)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await productionShop(tx);
      const batch = await importCsv(tx, s.id, csv("4001,Al,Lee,al@example.com,"));
      expect(batch.counts).toMatchObject({ held: 1 });
      const [row] = await invitations.listQueue(tx, s.id);
      expect(row.blockers).toEqual(["DELIVERY_DATE_NEEDED"]);
      await expect(invitations.issuePrintableLink(tx, actor, s.id, row.id)).rejects.toMatchObject({ kind: "invalid" });
      expect(await intentsFor(tx, s.id)).toBe(0);
    }));

  it("a correction sends nothing; the explicit send sends once and then refuses (AT-11)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await productionShop(tx);
      await importCsv(tx, s.id, csv("6001,Al,Lee,,2026-10-02", "6002,Bo,Kim,bo@example.com,2026-10-02"));
      const queue = await invitations.listQueue(tx, s.id);
      const held = queue.find((r) => r.sourceVisitKey === "6001")!;
      const corrected = await invitations.correctInvitation(tx, actor, s.id, held.id, held.revision, { email: "al@example.com", deliveredOn: "2026-10-02" });
      expect(await intentsFor(tx, s.id)).toBe(1);

      const [first] = await invitations.sendInvitations(tx, actor, s.id, [{ id: held.id, revision: corrected.revision }]);
      expect(first.ok).toBe(true);
      expect(await intentsFor(tx, s.id)).toBe(2);

      const after = (await invitations.listQueue(tx, s.id)).find((r) => r.id === held.id)!;
      const [second] = await invitations.sendInvitations(tx, actor, s.id, [{ id: held.id, revision: after.revision }]);
      expect(second).toMatchObject({ ok: false, reasons: ["ALREADY_SENT"] });
      // A stale revision is refused too.
      const [stale] = await invitations.sendInvitations(tx, actor, s.id, [{ id: held.id, revision: held.revision }]);
      expect(stale.ok).toBe(false);
    }));

  it("refuses an explicit send to a recipient who opted out at this shop only (SR-25)", () =>
    inRollback(async (tx) => {
      const a = await productionShop(tx);
      const b = await productionShop(tx);
      await tx.insert(shopOptOut).values({ shopId: a.shop.id, emailNormalized: "jo@example.com", source: "test" });
      const batchA = await importCsv(tx, a.shop.id, csv("7001,Jo,Smith,jo@example.com,2026-10-02"));
      const batchB = await importCsv(tx, b.shop.id, csv("7001,Jo,Smith,jo@example.com,2026-10-02"));
      expect(batchA.counts).toMatchObject({ held: 1 });
      expect(batchB.counts).toMatchObject({ created: 1 });
      const [row] = await invitations.listQueue(tx, a.shop.id);
      const [result] = await invitations.sendInvitations(tx, actor, a.shop.id, [{ id: row.id, revision: row.revision }]);
      expect(result).toMatchObject({ ok: false, reasons: ["SHOP_OPT_OUT"] });
    }));

  it("going Live sends nothing waiting; a new import then sends one; PSG selects the waiting ones (AT-04)", () =>
    inRollback(async (tx) => {
      const { shop: s, revision } = await productionShop(tx, "test");
      await importCsv(tx, s.id, csv("8001,A,One,a@example.com,2026-10-02", "8002,B,Two,b@example.com,2026-10-02"));
      expect(await intentsFor(tx, s.id)).toBe(0);
      expect((await invitations.listQueue(tx, s.id)).map((r) => r.view)).toEqual(["waiting", "waiting"]);

      await settings.changeMode(tx, actor, s.id, revision, "live");
      expect(await intentsFor(tx, s.id)).toBe(0);
      const ready = await invitations.listQueue(tx, s.id);
      expect(ready.map((r) => r.view)).toEqual(["ready", "ready"]);

      await importCsv(tx, s.id, csv("8003,C,Three,c@example.com,2026-10-02"));
      expect(await intentsFor(tx, s.id)).toBe(1);

      const pick = ready.find((r) => r.sourceVisitKey === "8001")!;
      await invitations.sendInvitations(tx, actor, s.id, [{ id: pick.id, revision: pick.revision }]);
      expect(await intentsFor(tx, s.id)).toBe(2);
    }));

  it("moving the cutoff earlier makes records ready for review, not sent (AT-05)", () =>
    inRollback(async (tx) => {
      const { shop: s, version } = await productionShop(tx);
      await importCsv(tx, s.id, csv("9001,A,One,a@example.com,2026-09-15"));
      expect((await invitations.listQueue(tx, s.id))[0].blockers).toEqual(["BEFORE_CUTOFF"]);
      const [current] = await tx.select().from(shopSurveySettings).where(eq(shopSurveySettings.shopId, s.id));
      await settings.updateSettings(
        tx,
        actor,
        s.id,
        current.revision,
        settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-09-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: [], logoUrl: "", brandColor: "" }),
      );
      expect((await invitations.listQueue(tx, s.id))[0].view).toBe("ready");
      expect(await intentsFor(tx, s.id)).toBe(0);
    }));

  it("test records reach only allowlisted addresses and never become production records (AT-03)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await productionShop(tx);
      const domain = `@qa-${unique().replace("_", "-")}.example`;
      await tx.insert(testRecipientAllowlist).values({ entry: domain });
      const batch = await importCsv(tx, s.id, csv(`1101,Q,A,tester${domain},2026-10-02`, "1102,C,U,customer@gmail.com,2026-10-02"), { isTest: true });
      expect(batch.counts).toMatchObject({ created: 1, held: 1 });
      const [intent] = await tx.select().from(emailIntent).innerJoin(invitation, eq(invitation.id, emailIntent.invitationId)).where(eq(invitation.shopId, s.id));
      expect(intent.email_intent).toMatchObject({ isTest: true, recipient: `tester${domain}` });
      // The database refuses to mix test and production flags.
      await expect(tx.transaction((inner) => inner.update(invitation).set({ isTest: false }).where(eq(invitation.shopId, s.id)))).rejects.toThrow();
      await expect(tx.transaction((inner) => inner.update(emailIntent).set({ isTest: false }).where(eq(emailIntent.id, intent.email_intent.id)))).rejects.toThrow();
    }));

  it("refuses unsafe batches before anything is written", () =>
    inRollback(async (tx) => {
      const [testShop] = await tx.insert(shop).values({ name: "T", publicSlug: `t-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      await settings.insertDefaultSettings(tx, testShop.id);
      await expect(store.createBatch(tx, actor, { shopId: testShop.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "x.csv", content: csv("1,A,B,,") })).rejects.toMatchObject({ kind: "invalid" });

      const { shop: s } = await productionShop(tx);
      const testVersion = await publish(tx, true);
      await tx.update(shopSurveySettings).set({ mode: "test", liveSince: null, instrumentVersionId: testVersion.id }).where(eq(shopSurveySettings.shopId, s.id));
      const batch = await store.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "x.csv", content: csv("1,A,B,a@example.com,2026-10-02") });
      await expect(store.commitBatch(tx, actor, batch.id, batch.revision)).rejects.toMatchObject({ kind: "invalid" });
      const [{ n }] = await tx.select({ n: count() }).from(repairVisit).where(and(eq(repairVisit.shopId, s.id)));
      expect(n).toBe(0);
    }));
});
