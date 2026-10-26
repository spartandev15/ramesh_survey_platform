/**
 * Database tests for the launch readiness manifest (SR-37, AT-37). Every test rolls back.
 */
import { and, count, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("launch readiness manifest", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { auditEvent, shop, shopSurveySettings, user } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const imports = await import("@/modules/imports/store");
  const readiness = await import("./store");
  type Tx = import("@/db/client").Tx;

  const system = { type: "system" } as const;
  const sendgrid = { provider: "sendgrid" as const, webhookKey: true, from: "surveys@psg.example" };
  const logOnly = { provider: "log" as const, webhookKey: false, from: "dev@psg.example" };
  const OTHER_ITEMS = ["mapping", "branding", "history", "opt_outs", "internal_test"];
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

  async function admin(tx: Tx) {
    const id = `ready-${unique()}`;
    await tx.insert(user).values({ id, name: "Ready Admin", email: `${id}@psg.test` });
    return { type: "user" as const, userId: id };
  }

  async function newShop(tx: Tx, isTestShop = false) {
    const [s] = await tx.insert(shop).values({ name: `Ready ${unique()}`, publicSlug: `ready-${unique().replace("_", "-")}`, isTestShop }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    return s;
  }

  /** Verified version, cutoff, recipients and legacy coverage: every automatic check passes. */
  async function configure(tx: Tx, shopId: string) {
    const { draft } = await instruments.insertInstrument(tx, system, { key: `ready_${unique()}`, name: "PSG" }, demoDefinition);
    const version = await instruments.publishVersion(tx, system, draft.id, draft.revision, { isTest: false, sourceNote: "Approved export" });
    await settings.updateSettings(
      tx,
      system,
      shopId,
      1,
      settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-01-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: ["owner@shop.example"], logoUrl: "", brandColor: "" }),
    );
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: new Date() }).where(eq(shopSurveySettings.shopId, shopId));
  }

  const shopIn = async (tx: Tx, shopId: string, email: import("./policy").EmailFacts = sendgrid) => (await readiness.manifest(tx, email)).shops.find((s) => s.shopId === shopId);

  afterAll(async () => {
    await getPool().end();
  });

  it("refuses the first switch to Live while the checklist is open, but not a resume (SR-37)", () =>
    inRollback(async (tx) => {
      const { requireLaunchReady } = await import("@/modules/shops/settings");
      const { ShopSettingsError } = settings;
      const s = await newShop(tx);
      await configure(tx, s.id);
      // Nothing is recorded yet (and acceptance is last), so the first Live switch is refused with the reasons.
      const refused = await requireLaunchReady(tx, s.id, "live").catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(ShopSettingsError);
      expect((refused as InstanceType<typeof ShopSettingsError>).issues.some((b) => b.startsWith("Launch checklist:"))).toBe(true);
      // Other targets are never gated.
      await expect(requireLaunchReady(tx, s.id, "paused")).resolves.toBeUndefined();
      // A shop that was Live before (now paused) resumes without the checklist.
      await tx.update(shopSurveySettings).set({ activatedAt: new Date() }).where(eq(shopSurveySettings.shopId, s.id));
      await expect(requireLaunchReady(tx, s.id, "live")).resolves.toBeUndefined();
    }));

  it("covers every in-scope shop and lists internal test shops apart (AT-37)", () =>
    inRollback(async (tx) => {
      const real = await newShop(tx);
      const internal = await newShop(tx, true);
      const m = await readiness.manifest(tx, sendgrid);
      const [{ n }] = await tx.select({ n: count() }).from(shop).where(and(isNull(shop.archivedAt), eq(shop.isTestShop, false)));
      expect(m.shops).toHaveLength(n);
      expect(m.shops.some((s) => s.shopId === real.id)).toBe(true);
      expect(m.shops.some((s) => s.shopId === internal.id)).toBe(false);
      expect(m.testShops.some((s) => s.shopId === internal.id)).toBe(true);
      const fresh = m.shops.find((s) => s.shopId === real.id)!;
      expect(fresh.ready).toBe(false);
      expect(fresh.missing.map((c) => c.key)).toEqual(["mapping", "version", "cutoff", "recipients", "legacy", "branding", "history", "opt_outs", "internal_test", "acceptance"]);
    }));

  it("reports unsent production visits and refuses a checklist for a test shop", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      await configure(tx, s.id);
      const batch = await imports.createBatch(tx, system, { shopId: s.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "r.csv", content: "RO,Last Name,Delivered On\nR1,Smith,2026-09-10\nR2,Lee," });
      await imports.commitBatch(tx, system, batch.id, batch.revision);
      const unsent = (await shopIn(tx, s.id))!.checks.find((c) => c.key === "unsent")!;
      expect(unsent).toMatchObject({ status: "info" });
      expect(unsent.detail).toContain("2 visits");

      const internal = await newShop(tx, true);
      const a = await admin(tx);
      await expect(readiness.confirmItem(tx, a, internal.id, "mapping", "Checked the company", sendgrid)).rejects.toMatchObject({ kind: "invalid" });
    }));

  it("accepts a shop only when everything else passes, including the email setup", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const a = await admin(tx);
      await expect(readiness.confirmItem(tx, a, s.id, "mapping", "ok", sendgrid)).rejects.toMatchObject({ kind: "invalid" });
      await expect(readiness.confirmItem(tx, a, s.id, "version", "Looks right", sendgrid)).rejects.toMatchObject({ kind: "invalid" });
      for (const item of OTHER_ITEMS) await readiness.confirmItem(tx, a, s.id, item, `Checked ${item} with the shop`, sendgrid);
      await expect(readiness.confirmItem(tx, a, s.id, "mapping", "Again please", sendgrid)).rejects.toMatchObject({ kind: "conflict" });

      // Automatic checks still fail: acceptance is refused and names what is missing.
      await expect(readiness.confirmItem(tx, a, s.id, "acceptance", "Ready to go", sendgrid)).rejects.toThrow(/Verified survey version/);
      await configure(tx, s.id);
      // Email only goes to the log: still refused.
      await expect(readiness.confirmItem(tx, a, s.id, "acceptance", "Ready to go", logOnly)).rejects.toThrow(/Real email provider/);
      await readiness.confirmItem(tx, a, s.id, "acceptance", "Ready to go", sendgrid);
      const accepted = (await shopIn(tx, s.id))!;
      expect(accepted.ready).toBe(true);
      expect(accepted.checks.find((c) => c.key === "acceptance")?.confirmation).toMatchObject({ by: "Ready Admin", note: "Ready to go" });
      expect((await shopIn(tx, s.id, logOnly))!.ready).toBe(false);

      // Removing the cutoff later makes the shop not ready again, without anyone editing the checklist.
      await tx.update(shopSurveySettings).set({ deliveryCutoff: null }).where(eq(shopSurveySettings.shopId, s.id));
      expect((await shopIn(tx, s.id))!.missing.map((c) => c.key)).toEqual(["cutoff"]);
    }));

  it("withdrawing a check also withdraws acceptance, and both are audited", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const a = await admin(tx);
      await configure(tx, s.id);
      for (const item of OTHER_ITEMS) await readiness.confirmItem(tx, a, s.id, item, `Checked ${item} with the shop`, sendgrid);
      await readiness.confirmItem(tx, a, s.id, "acceptance", "Ready to go", sendgrid);
      await readiness.withdrawItem(tx, a, s.id, "branding");
      expect((await shopIn(tx, s.id))!.missing.map((c) => c.key)).toEqual(["branding", "acceptance"]);
      await expect(readiness.withdrawItem(tx, a, s.id, "branding")).rejects.toMatchObject({ kind: "conflict" });

      const events = await tx.select({ action: auditEvent.action, after: auditEvent.after }).from(auditEvent).where(and(eq(auditEvent.subjectType, "shop"), eq(auditEvent.subjectId, s.id)));
      expect(events.filter((e) => e.action === "shop.readiness_confirmed")).toHaveLength(6);
      expect(events.filter((e) => e.action === "shop.readiness_withdrawn").map((e) => (e.after as { item: string }).item).sort()).toEqual(["acceptance", "branding"]);
    }));
});
