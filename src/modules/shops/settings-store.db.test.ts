/**
 * Database tests for shop survey settings (SR-02..SR-05, SR-26, AT-44).
 * Every test rolls back.
 */
import { count, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("shop survey settings", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { auditEvent, invitation, shop, shopSurveySettings } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const responses = await import("@/modules/responses/store");
  const store = await import("./settings-store");
  const { settingsInputSchema } = await import("./settings-policy");
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

  /** Run a statement expected to fail inside a savepoint so the outer transaction survives. */
  async function expectDbRejects(tx: Tx, body: (inner: Tx) => Promise<unknown>) {
    await expect(tx.transaction(async (inner) => void (await body(inner)))).rejects.toThrow();
  }

  async function publish(tx: Tx, isTest: boolean) {
    const { draft } = await instruments.insertInstrument(tx, actor, { key: `shop_${unique()}`, name: "Demo" }, demoDefinition);
    return instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest, sourceNote: isTest ? null : "Approved export, checksum abc" });
  }

  async function newShop(tx: Tx, isTestShop = false) {
    const [s] = await tx.insert(shop).values({ name: "Settings Shop", publicSlug: `settings-${unique().replace("_", "-")}`, isTestShop }).returning();
    await store.insertDefaultSettings(tx, s.id);
    return s;
  }

  const input = (overrides: Record<string, unknown> = {}) =>
    settingsInputSchema.parse({
      instrumentVersionId: "",
      deliveryCutoff: "2026-10-01",
      timezone: "America/Chicago",
      reminderDelayDays: 7,
      linkLifetimeDays: 90,
      alertRecipients: ["owner@shop.example"],
      logoUrl: "",
      brandColor: "",
      ...overrides,
    });

  /** A production shop with a verified version assigned, ready for Live. */
  async function readyShop(tx: Tx) {
    const s = await newShop(tx);
    const verified = await publish(tx, false);
    const saved = await store.updateSettings(tx, actor, s.id, 1, input({ instrumentVersionId: verified.id }));
    return { shop: s, verified, revision: saved.revision };
  }

  afterAll(async () => {
    await getPool().end();
  });

  it("starts every shop in Test mode with the default timing (SR-03, D-07)", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const view = await store.getSettings(tx, s.id);
      expect(view?.settings).toMatchObject({ mode: "test", reminderDelayDays: 7, linkLifetimeDays: 90, activatedAt: null, liveSince: null, revision: 1 });
    }));

  it("rejects a stale revision so two editors cannot overwrite each other", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      await store.updateSettings(tx, actor, s.id, 1, input());
      await expect(store.updateSettings(tx, actor, s.id, 1, input({ reminderDelayDays: 3 }))).rejects.toMatchObject({ kind: "conflict" });
    }));

  it("audits only the fields that changed, including branding (SR-02)", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      await store.updateSettings(tx, actor, s.id, 1, input({ brandColor: "#112233" }));
      const [event] = await tx.select().from(auditEvent).where(eq(auditEvent.subjectId, s.id)).orderBy(sql`${auditEvent.id} desc`).limit(1);
      expect(event.action).toBe("shop.settings_updated");
      expect(Object.keys(event.after as object).sort()).toEqual(["alertRecipients", "brandColor", "deliveryCutoff", "timezone"]);
      const [updated] = await tx.select().from(shop).where(eq(shop.id, s.id));
      expect(updated.brandColor).toBe("#112233");
    }));

  it("switching to Live sends nothing and records the activation (AT-04)", () =>
    inRollback(async (tx) => {
      const { shop: s, revision } = await readyShop(tx);
      const [{ n: before }] = await tx.select({ n: count() }).from(invitation).where(eq(invitation.shopId, s.id));
      const now = new Date("2026-10-05T15:00:00Z");
      const live = await store.changeMode(tx, actor, s.id, revision, "live", now);
      expect(live).toMatchObject({ mode: "live", activatedAt: now, liveSince: now });
      const [{ n: after }] = await tx.select({ n: count() }).from(invitation).where(eq(invitation.shopId, s.id));
      expect(after).toBe(before);
    }));

  it("pause clears the Live period and resume starts a new one, keeping first activation (SR-26)", () =>
    inRollback(async (tx) => {
      const { shop: s, revision } = await readyShop(tx);
      const first = new Date("2026-10-05T15:00:00Z");
      const live = await store.changeMode(tx, actor, s.id, revision, "live", first);
      const paused = await store.changeMode(tx, actor, s.id, live.revision, "paused", new Date("2026-10-06T15:00:00Z"));
      expect(paused).toMatchObject({ mode: "paused", liveSince: null, activatedAt: first });
      const resumedAt = new Date("2026-10-07T15:00:00Z");
      const resumed = await store.changeMode(tx, actor, s.id, paused.revision, "live", resumedAt);
      expect(resumed).toMatchObject({ mode: "live", liveSince: resumedAt, activatedAt: first });
      await expect(store.changeMode(tx, actor, s.id, resumed.revision, "test")).rejects.toMatchObject({ kind: "invalid" });
    }));

  it("keeps TEST versions and internal test shops out of Live (AT-14)", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const testVersion = await publish(tx, true);
      const saved = await store.updateSettings(tx, actor, s.id, 1, input({ instrumentVersionId: testVersion.id }));
      await expect(store.changeMode(tx, actor, s.id, saved.revision, "live")).rejects.toMatchObject({ kind: "invalid" });

      const testShop = await newShop(tx, true);
      const verified = await publish(tx, false);
      const ts = await store.updateSettings(tx, actor, testShop.id, 1, input({ instrumentVersionId: verified.id }));
      await expect(store.changeMode(tx, actor, testShop.id, ts.revision, "live")).rejects.toMatchObject({ kind: "invalid" });
    }));

  it("the database itself refuses unsafe settings, whatever writes them", () =>
    inRollback(async (tx) => {
      const { shop: s, verified } = await readyShop(tx);
      const testVersion = await publish(tx, true);
      const { draft } = await instruments.insertInstrument(tx, actor, { key: `draft_${unique()}`, name: "Draft" }, demoDefinition);
      const now = new Date();
      const setRow = (inner: Tx, values: Partial<typeof shopSurveySettings.$inferInsert>) => inner.update(shopSurveySettings).set(values).where(eq(shopSurveySettings.shopId, s.id));

      await expectDbRejects(tx, (inner) => setRow(inner, { instrumentVersionId: draft.id }));
      await expectDbRejects(tx, (inner) => setRow(inner, { mode: "live", activatedAt: now, liveSince: now, instrumentVersionId: testVersion.id }));
      await expectDbRejects(tx, (inner) => setRow(inner, { mode: "live", activatedAt: now, liveSince: null }));
      await expectDbRejects(tx, (inner) => setRow(inner, { mode: "live", activatedAt: now, liveSince: now, deliveryCutoff: null }));
      // The same row with valid values is accepted.
      await setRow(tx, { mode: "live", activatedAt: now, liveSince: now, instrumentVersionId: verified.id });
    }));

  it("reassigning an earlier version affects only future invitations (AT-44)", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const v1 = await publish(tx, true);
      const v2 = await publish(tx, true);
      const a = await store.updateSettings(tx, actor, s.id, 1, input({ instrumentVersionId: v2.id }));
      const issued = await responses.createTestInvitation(tx, actor, { shopId: s.id, instrumentVersionId: v2.id, lifetimeDays: 90 });

      await store.updateSettings(tx, actor, s.id, a.revision, input({ instrumentVersionId: v1.id }));
      const view = await store.getSettings(tx, s.id);
      expect(view?.settings.instrumentVersionId).toBe(v1.id);
      const [kept] = await tx.select().from(invitation).where(eq(invitation.id, issued.invitationId));
      expect(kept.instrumentVersionId).toBe(v2.id);
      // The customer's existing link still renders and scores the version it was issued with (AT-15).
      const opened = await responses.getTokenState(tx, issued.token);
      expect(opened.state).toBe("open");
      if (opened.state !== "open") return;
      expect(opened.context.version.id).toBe(v2.id);
      expect(opened.context.version.definitionHash).toBe(v2.definitionHash);
    }));

  it("a Live shop cannot drop its cutoff or switch to a TEST version", () =>
    inRollback(async (tx) => {
      const { shop: s, verified, revision } = await readyShop(tx);
      const live = await store.changeMode(tx, actor, s.id, revision, "live");
      await expect(store.updateSettings(tx, actor, s.id, live.revision, input({ instrumentVersionId: verified.id, deliveryCutoff: "" }))).rejects.toMatchObject({ kind: "invalid" });
      const testVersion = await publish(tx, true);
      await expect(store.updateSettings(tx, actor, s.id, live.revision, input({ instrumentVersionId: testVersion.id }))).rejects.toMatchObject({ kind: "invalid" });
      // Moving the cutoff earlier while Live is allowed and sends nothing (AT-05).
      const moved = await store.updateSettings(tx, actor, s.id, live.revision, input({ instrumentVersionId: verified.id, deliveryCutoff: "2026-06-01" }));
      expect(moved.deliveryCutoff).toBe("2026-06-01");
    }));

  it("manages the internal test recipient allowlist (SR-03, AT-03)", () =>
    inRollback(async (tx) => {
      const domain = `@qa-${unique().replace("_", "-")}.example`;
      const entry = await store.addAllowlistEntry(tx, actor, domain.toUpperCase(), "QA team");
      expect(entry.entry).toBe(domain);
      await expect(store.addAllowlistEntry(tx, actor, domain, null)).rejects.toMatchObject({ kind: "conflict" });
      expect(await store.isAllowlistedTestRecipient(tx, `tester${domain}`)).toBe(true);
      expect(await store.isAllowlistedTestRecipient(tx, "customer@gmail.com")).toBe(false);
      await store.removeAllowlistEntry(tx, actor, entry.id);
      expect(await store.isAllowlistedTestRecipient(tx, `tester${domain}`)).toBe(false);
    }));
});
