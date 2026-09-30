/**
 * PSG CSV exports through their real routes (SR-38, SR-40; PDF 07 suite 8
 * "export download authorization"): PSG staff get the file and every
 * response or queue export is audited; a shop user gets nothing (404);
 * "Export selected" with nothing ticked exports no rows, never everything;
 * a value that looks like a formula is written as text. The signed-in user
 * is replaced by a fixed principal. Commits test-only data in an internal test shop.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

describe.skipIf(!process.env.DATABASE_URL)("PSG CSV exports: authorized, audited and formula-safe (AT-38, AT-40)", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { auditEvent, shop, shopSurveySettings, surveyResponse, user } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const staff = await import("@/modules/responses/staff-store");
  const responsesExport = await import("./route");
  const operationsExport = await import("../../operations/export/route");
  const shopsExport = await import("../../shops/export/route");

  const unique = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const system = { type: "system" } as const;
  const answers = { overall_rating: 4, ready_on_time: "yes", service_aspects: { communication: "good", quality: "good", cleanliness: "good" }, recommend_score: 9 };
  const url = (path: string) => new Request(`https://survey.test${path}`);
  const rows = async (res: Response) => (await res.text()).replace(/^﻿/, "").trim().split("\r\n");

  let shopId = "";
  let responseId = "";
  let adminId = "";
  let shopUserId = "";

  beforeAll(async () => {
    await getDb().transaction(async (tx) => {
      const [s] = await tx.insert(shop).values({ name: `E2E Export (internal test)`, publicSlug: `export-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      await settings.insertDefaultSettings(tx, s.id);
      const { draft } = await instruments.insertInstrument(tx, system, { key: `export_${unique()}`, name: "Demo" }, demoDefinition);
      const version = await instruments.publishVersion(tx, system, draft.id, draft.revision, { isTest: true });
      await tx.update(shopSurveySettings).set({ instrumentVersionId: version.id }).where(eq(shopSurveySettings.shopId, s.id));
      // A name that a spreadsheet would run as a formula.
      await staff.submitPublic(tx, { slug: s.publicSlug!, versionId: version.id, answers, context: { name: "=HYPERLINK(1)" }, requestKey: `export-${unique()}` });
      shopId = s.id;
      const [r] = await tx.select().from(surveyResponse).where(eq(surveyResponse.shopId, s.id));
      responseId = r.id;
    });
    adminId = `export-admin-${unique()}`;
    shopUserId = `export-shop-${unique()}`;
    await getDb().insert(user).values([
      { id: adminId, name: "Export admin", email: `${adminId}@psg.invalid` },
      { id: shopUserId, name: "Export shop user", email: `${shopUserId}@shop.invalid` },
    ]);
  });

  afterAll(async () => {
    await getPool().end();
  });

  const asAdmin = () => (current = { principal: { userId: adminId, psgRoles: ["psg_admin"], shopIds: [] }, name: "Export admin", email: `${adminId}@psg.invalid` });
  const asShopUser = () => (current = { principal: { userId: shopUserId, psgRoles: [], shopIds: [shopId] }, name: "Export shop user", email: `${shopUserId}@shop.invalid` });
  const audits = (action: string) => getDb().select().from(auditEvent).where(and(eq(auditEvent.action, action), eq(auditEvent.actorUserId, adminId)));

  it("a shop user gets nothing from any PSG export", async () => {
    asShopUser();
    expect((await responsesExport.GET(url(`/psg/responses/export?id=${responseId}`))).status).toBe(404);
    expect((await responsesExport.GET(url("/psg/responses/export"))).status).toBe(404);
    expect((await operationsExport.GET(url("/psg/operations/export?test=1"))).status).toBe(404);
    expect((await shopsExport.GET(url("/psg/shops/export"))).status).toBe(404);
    current = null;
    expect((await responsesExport.GET(url("/psg/responses/export"))).status).toBe(401);
  });

  it("exports one response, never everything when nothing is ticked, and audits each export", async () => {
    asAdmin();
    const one = await responsesExport.GET(url(`/psg/responses/export?id=${responseId}`));
    expect(one.status).toBe(200);
    expect(one.headers.get("cache-control")).toBe("no-store");
    const [header, row, ...rest] = await rows(one);
    expect(header).toContain('"response_id"');
    expect(row).toContain(`"${responseId}"`);
    expect(row).toContain(`"'=HYPERLINK(1)"`);
    expect(rest).toHaveLength(0);

    const none = await responsesExport.GET(url("/psg/responses/export?selected=1"));
    expect(await rows(none)).toHaveLength(1);

    const events = await audits("responses.exported");
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.subjectId === responseId)).toBe(true);
  });

  it("the operator queue export is audited too", async () => {
    asAdmin();
    const res = await operationsExport.GET(url("/psg/operations/export?test=1"));
    expect(res.status).toBe(200);
    expect((await rows(res))[0]).toContain('"Queue","Item","Shop"');
    expect((await audits("operator_queue.exported")).length).toBeGreaterThanOrEqual(1);
  });
});
