/**
 * AT-01 for writes: a shop user can change only their own shop's approved
 * cases. Another shop's case, or a case under the wrong shop id, is simply
 * not found, and PSG-only actions are refused. Runs the authorized entry
 * points with the signed-in user replaced by a fixed principal.
 * Commits test-only data in two internal test shops (the entry points open their own transactions).
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/access/principal";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

let current: CurrentUser | null = null;

vi.mock("@/modules/access/principal", async () => {
  const caps = await import("@/modules/access/capabilities");
  const errors = await import("@/modules/access/errors");
  const signedIn = () => {
    if (!current) throw new errors.UnauthenticatedError();
    return current;
  };
  return {
    getCurrentUser: async () => current,
    requireUser: async () => signedIn(),
    requireCapability: async (capability: Parameters<typeof caps.hasCapability>[1]) => {
      const user = signedIn();
      if (!caps.hasCapability(user.principal, capability)) throw new errors.ForbiddenError();
      return user;
    },
    requireShopRead: async (shopId: string) => {
      const user = signedIn();
      if (!caps.canReadShop(user.principal, shopId)) throw new errors.NotFoundError();
      return user;
    },
  };
});

describe.skipIf(!process.env.DATABASE_URL)("shop users cannot change another shop's data (AT-01)", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { alertCase, caseNote, shop, shopSurveySettings, user } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const staff = await import("@/modules/responses/staff-store");
  const store = await import("./store");
  const cases = await import("./cases");
  const { ForbiddenError, NotFoundError } = await import("@/modules/access/errors");

  const system = { type: "system" } as const;
  const unique = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const low = { overall_rating: 1, ready_on_time: "no", delay_detail: "Late", service_aspects: { communication: "poor", quality: "poor", cleanliness: "poor" }, recommend_score: 1 };

  /** An internal test shop with one approved negative-feedback case. */
  async function shopWithCase(label: string) {
    return getDb().transaction(async (tx) => {
      const [s] = await tx.insert(shop).values({ name: `E2E Isolation ${label} (internal test)`, publicSlug: `iso-${label.toLowerCase()}-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      await settings.insertDefaultSettings(tx, s.id);
      const { draft } = await instruments.insertInstrument(tx, system, { key: `iso_${unique()}`, name: "Demo" }, demoDefinition);
      const version = await instruments.publishVersion(tx, system, draft.id, draft.revision, { isTest: true });
      await tx.update(shopSurveySettings).set({ instrumentVersionId: version.id }).where(eq(shopSurveySettings.shopId, s.id));
      const paper = await staff.submitPaper(tx, system, { shopId: s.id, visitId: null, receivedOn: "2026-09-20", answers: low, requestKey: `iso-${unique()}` });
      const c = (await store.caseForResponse(tx, paper.responseId))!;
      const [row] = await tx.select().from(alertCase).where(eq(alertCase.id, c.id));
      await store.approveAndSend(tx, system, c.id, row.revision, ["qa@isolation.invalid"], "");
      return { shopId: s.id, caseId: c.id, revision: row.revision + 1 };
    });
  }

  afterAll(async () => {
    await getPool().end();
  });

  it("refuses notes, closure requests and PSG actions outside the user's own shop", async () => {
    const a = await shopWithCase("A");
    const b = await shopWithCase("B");
    const userId = `iso-${unique()}`;
    await getDb().insert(user).values({ id: userId, name: "Shop A user", email: `${userId}@shop-a.invalid` });
    current = { principal: { userId, psgRoles: [], shopIds: [a.shopId] }, name: "Shop A user", email: `${userId}@shop-a.invalid` };

    // Their own shop works.
    await cases.addShopNote(a.shopId, a.caseId, "Called the customer back");
    // Shop B's case, by B's id or smuggled under A's id, is not found.
    await expect(cases.addShopNote(b.shopId, b.caseId, "Not mine")).rejects.toBeInstanceOf(NotFoundError);
    await expect(cases.addShopNote(a.shopId, b.caseId, "Not mine")).rejects.toBeInstanceOf(NotFoundError);
    await expect(cases.requestShopClosure(b.shopId, b.caseId, b.revision, "Closing another shop's case")).rejects.toBeInstanceOf(NotFoundError);
    await expect(cases.requestShopClosure(a.shopId, b.caseId, b.revision, "Closing another shop's case")).rejects.toBeInstanceOf(NotFoundError);
    await expect(cases.getShopCase(b.shopId, b.caseId)).rejects.toBeInstanceOf(NotFoundError);
    // PSG-only decisions are refused outright.
    await expect(cases.resolveCase(a.caseId, a.revision, "resolved_with_customer", "")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cases.addPsgNote(b.caseId, "internal", "internal")).rejects.toBeInstanceOf(ForbiddenError);

    const notesOnB = await getDb().select().from(caseNote).where(eq(caseNote.caseId, b.caseId));
    expect(notesOnB).toHaveLength(0);
    const notesOnA = await getDb().select().from(caseNote).where(eq(caseNote.caseId, a.caseId));
    expect(notesOnA.map((n) => n.body)).toEqual(["Called the customer back"]);
  });
});
