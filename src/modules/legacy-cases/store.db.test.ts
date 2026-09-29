/**
 * Database tests for legacy unresolved-case handoff (SR-46, AT-46). Every test rolls back.
 */
import { and, count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("legacy case handoff", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { historicalResponse, legacyCase, shop, user } = await import("@/db/schema");
  const settings = await import("@/modules/shops/settings-store");
  const imports = await import("@/modules/imports/store");
  const legacy = await import("./store");
  type Tx = import("@/db/client").Tx;

  const system = { type: "system" } as const;
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

  async function newShop(tx: Tx) {
    const [s] = await tx.insert(shop).values({ name: `Legacy Shop ${unique()}`, publicSlug: `legacy-${unique().replace("_", "-")}` }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    return s;
  }

  async function staffUser(tx: Tx) {
    const id = `legacy-${unique()}`;
    await tx.insert(user).values({ id, name: "Case Owner", email: `${id}@psg.test` });
    return { type: "user" as const, userId: id };
  }

  const HEADER = "Case ID,Status,Opened,Issue,Owner,RO,Customer,Response ID,Notes";
  async function importCases(tx: Tx, shopId: string, lines: string[]) {
    const batch = await imports.createBatch(tx, system, { shopId, kind: "legacy_cases", isTest: false, sourceSystem: "shop_documents", fileName: "cases.csv", content: [HEADER, ...lines].join("\n") });
    const preview = await imports.previewBatch(tx, batch.id);
    const committed = await imports.commitBatch(tx, system, batch.id, batch.revision);
    return { preview, counts: committed.counts as Record<string, number> };
  }
  const caseFor = async (tx: Tx, shopId: string, ref: string) => (await tx.select().from(legacyCase).where(and(eq(legacyCase.shopId, shopId), eq(legacyCase.sourceRef, ref))))[0];

  afterAll(async () => {
    await getPool().end();
  });

  it("imports open and closed cases, rejects unclear rows, and a dry run writes nothing", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const batch = await imports.createBatch(tx, system, {
        shopId: s.id,
        kind: "legacy_cases",
        isTest: false,
        sourceSystem: "shop_documents",
        fileName: "cases.csv",
        content: [HEADER, "C1,Open,2026-06-01,Paint mismatch,Dana,R1,Jo Smith,H1,Called twice", "C2,Resolved,2026-05-01,Late,Dana,R2,Al Lee,,", "C3,Maybe,,Unclear,,,,,", ",Open,,No id,,,,,", "C1,Open,,Repeated,,,,,"].join("\n"),
      });
      const preview = await imports.previewBatch(tx, batch.id);
      expect(preview.counts).toMatchObject({ created: 2, rejected: 3 });
      expect(preview.rows.map((r) => r.reasons)).toEqual([[], ["CLOSED_REFERENCE_ONLY"], ["STATUS_UNKNOWN"], ["CASE_ID_MISSING"], ["CASE_REPEATED_IN_FILE"]]);
      // Preview is a dry run.
      expect((await tx.select({ n: count() }).from(legacyCase).where(eq(legacyCase.shopId, s.id)))[0].n).toBe(0);

      await imports.commitBatch(tx, system, batch.id, batch.revision);
      expect(await caseFor(tx, s.id, "C1")).toMatchObject({ legacyStatus: "open", summary: "Paint mismatch", legacyOwner: "Dana", visitKey: "R1", customerName: "Jo Smith", responseRef: "H1", legacyNotes: "Called twice", openedOn: "2026-06-01" });
      expect(await caseFor(tx, s.id, "C2")).toMatchObject({ legacyStatus: "closed" });
      // Legacy cases are production evidence: never test data.
      await expect(imports.createBatch(tx, system, { shopId: s.id, kind: "legacy_cases", isTest: true, sourceSystem: "shop_documents", fileName: "t.csv", content: `${HEADER}\nC9,Open,,,,,,,` })).rejects.toMatchObject({ kind: "invalid" });
    }));

  it("repeated imports never create a second case, and stop changing one Hub took over (AT-46)", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const owner = await staffUser(tx);
      await importCases(tx, s.id, ["C1,Open,2026-06-01,Paint mismatch,Dana,,,,"]);
      const again = await importCases(tx, s.id, ["C1,Open,2026-06-01,Paint mismatch and a scratch,Dana,,,,"]);
      expect(again.counts).toMatchObject({ created: 0, reused: 1 });
      expect((await tx.select({ n: count() }).from(legacyCase).where(eq(legacyCase.shopId, s.id)))[0].n).toBe(1);
      const updated = await caseFor(tx, s.id, "C1");
      expect(updated.summary).toBe("Paint mismatch and a scratch");

      await legacy.handOff(tx, owner, updated.id, updated.revision, "Agreed with Dana on 28 Sep: FileMaker follow-up stopped");
      const third = await importCases(tx, s.id, ["C1,Closed,2026-06-01,Changed in legacy after handoff,Dana,,,,"]);
      expect(third.preview.rows[0].reasons).toEqual(["ALREADY_IN_HUB"]);
      const after = await caseFor(tx, s.id, "C1");
      expect(after).toMatchObject({ legacyStatus: "open", summary: "Paint mismatch and a scratch" });
      expect((await tx.select({ n: count() }).from(legacyCase).where(eq(legacyCase.shopId, s.id)))[0].n).toBe(1);
      // The database refuses it too.
      expect(await dbError(tx, (sp) => sp.update(legacyCase).set({ summary: "Edited" }).where(eq(legacyCase.id, after.id)))).toMatch(/keeps its legacy record/);
      expect(await dbError(tx, (sp) => sp.delete(legacyCase).where(eq(legacyCase.id, after.id)))).toMatch(/cannot be deleted/);
    }));

  it("keeps closed cases reference only and requires an explicit handoff note", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const owner = await staffUser(tx);
      await importCases(tx, s.id, ["C1,Open,,Paint,,,,,", "C2,Closed,,Late,,,,,"]);
      const open = await caseFor(tx, s.id, "C1");
      const closed = await caseFor(tx, s.id, "C2");
      await expect(legacy.handOff(tx, owner, closed.id, closed.revision, "Taking it over from Dana today")).rejects.toMatchObject({ kind: "invalid" });
      await expect(legacy.handOff(tx, owner, open.id, open.revision, "ok")).rejects.toMatchObject({ kind: "invalid" });
      await expect(legacy.addNote(tx, owner, open.id, "Called the customer")).rejects.toMatchObject({ kind: "invalid" });
      await legacy.handOff(tx, owner, open.id, open.revision, "Agreed with Dana: she stops, Hub follows up");
      await expect(legacy.handOff(tx, owner, open.id, open.revision + 1, "Again please, twice")).rejects.toMatchObject({ kind: "conflict" });

      const counts = await legacy.legacyCaseCounts(tx);
      expect(counts.in_hub).toBeGreaterThanOrEqual(1);
      expect(counts.reference).toBeGreaterThanOrEqual(1);
    }));

  it("follows up in Hub with notes and a PSG-confirmed resolution that stands", () =>
    inRollback(async (tx) => {
      const s = await newShop(tx);
      const owner = await staffUser(tx);
      await importCases(tx, s.id, ["C1,Open,,Paint,,,,H7,"]);
      await tx.insert(historicalResponse).values({ shopId: s.id, sourceSystem: "supabase", sourceRef: "H7", respondedOn: "2026-05-30", measures: { overall: { value: 2, scale: "1-5" } } });
      let c = await caseFor(tx, s.id, "C1");
      await legacy.handOff(tx, owner, c.id, c.revision, "Agreed with Dana: Hub follows up from today");
      await legacy.addNote(tx, owner, c.id, "Left a voicemail");
      c = await caseFor(tx, s.id, "C1");
      await expect(legacy.resolve(tx, owner, c.id, c.revision, "made_up", "Sorted")).rejects.toMatchObject({ kind: "invalid" });
      await legacy.resolve(tx, owner, c.id, c.revision, "resolved_with_customer", "Repainted the door, customer happy");

      const detail = await legacy.getLegacyCase(tx, c.id);
      expect(detail?.c).toMatchObject({ resolutionOutcome: "resolved_with_customer" });
      expect(detail?.notes.map((n) => n.body)).toEqual(["Left a voicemail", "Resolved: Repainted the door, customer happy"]);
      // The historical answers are shown, read-only.
      expect(detail?.historical).toMatchObject({ respondedOn: "2026-05-30", measures: { overall: { value: 2, scale: "1-5" } } });
      expect(await dbError(tx, (sp) => sp.update(legacyCase).set({ resolutionOutcome: "no_action_needed" }).where(eq(legacyCase.id, c.id)))).toMatch(/stays resolved/);
    }));
});
