/**
 * Database tests for the shop dashboard (SR-27, SR-28, SR-30, SR-31).
 * Every test rolls back.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("shop dashboard", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { historicalResponse, invitation, repairVisit, shop, shopSurveySettings, surveyResponse } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const imports = await import("@/modules/imports/store");
  const invitations = await import("@/modules/invitations/store");
  const responses = await import("@/modules/responses/store");
  const staff = await import("@/modules/responses/staff-store");
  const store = await import("./store");
  const { summarize, parseFilters, localDate } = await import("./cohort");
  type Tx = import("@/db/client").Tx;

  const actor = { type: "system" } as const;
  class Rollback extends Error {}
  const unique = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const today = localDate(new Date(), "America/Chicago");
  const filters = parseFilters({}, today);

  async function inRollback(body: (tx: Tx) => Promise<void>) {
    await expect(
      getDb().transaction(async (tx) => {
        await body(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  const low = { overall_rating: 1, ready_on_time: "no", delay_detail: "Late", service_aspects: { communication: "poor", quality: "poor", cleanliness: "poor" }, recommend_score: 1 };
  const high = { overall_rating: 5, ready_on_time: "yes", service_aspects: { communication: "excellent", quality: "excellent", cleanliness: "excellent" }, recommend_score: 10 };

  async function liveShop(tx: Tx, keys: string[]) {
    const [s] = await tx.insert(shop).values({ name: "Dash Shop", publicSlug: `dash-${unique().replace("_", "-")}`, timezone: "America/Chicago" }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    const { draft } = await instruments.insertInstrument(tx, actor, { key: `dash_${unique()}`, name: "Demo" }, demoDefinition);
    const version = await instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest: false, sourceNote: "Approved export, checksum abc" });
    const saved = await settings.updateSettings(
      tx,
      actor,
      s.id,
      1,
      settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-01-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: [], logoUrl: "", brandColor: "" }),
    );
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: new Date() }).where(eq(shopSurveySettings.shopId, s.id));
    await settings.changeMode(tx, actor, s.id, saved.revision, "live");
    if (keys.length > 0) {
      const content = ["RO,Last Name,Delivered On", ...keys.map((k) => `${k},Smith,${today}`)].join("\n");
      const batch = await imports.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "d.csv", content });
      await imports.commitBatch(tx, actor, batch.id, batch.revision);
    }
    return { shop: s, version };
  }

  /** Submit online answers for the visit with this key, as the customer would. */
  async function submitOnline(tx: Tx, shopId: string, key: string, answers: unknown) {
    const [row] = await tx.select({ id: invitation.id }).from(invitation).innerJoin(repairVisit, eq(repairVisit.id, invitation.visitId)).where(and(eq(repairVisit.shopId, shopId), eq(repairVisit.sourceVisitKey, key)));
    const link = await invitations.issuePrintableLink(tx, actor, shopId, row.id);
    const result = await responses.submitResponse(tx, link.token, `k-${unique()}`, answers);
    if (!result.ok) throw new Error(`submit failed: ${JSON.stringify(result)}`);
    return result.responseId;
  }

  async function dashboard(tx: Tx, shopId: string, isTestShop = false) {
    const rows = await store.cohortRows(tx, shopId, filters, "America/Chicago");
    const versions = await store.versionDetails(tx, [...new Set(rows.map((r) => r.versionId))]);
    return { rows, summary: summarize(rows, isTestShop, versions, "America/Chicago", filters) };
  }

  afterAll(async () => {
    await getPool().end();
  });

  it("shows a submitted result, including a negative one, immediately and only to its shop (AT-27)", () =>
    inRollback(async (tx) => {
      const a = await liveShop(tx, ["A1"]);
      const b = await liveShop(tx, ["A1"]);
      const id = await submitOnline(tx, a.shop.id, "A1", low);
      const dashA = await dashboard(tx, a.shop.id);
      expect(dashA.rows.map((r) => r.id)).toEqual([id]);
      expect(dashA.summary.counts.counted).toBe(1);
      expect(dashA.summary.groups[0].withAlerts).toBe(1);
      expect((await dashboard(tx, b.shop.id)).rows).toHaveLength(0);
      expect(await store.shopResponse(tx, b.shop.id, id, false)).toBeNull();
      expect(await store.shopResponse(tx, a.shop.id, id, false)).toMatchObject({ id, category: "counted" });
    }));

  it("lists an unmatched public response without changing the score, then counts it once when matched (AT-28)", () =>
    inRollback(async (tx) => {
      const { shop: s, version } = await liveShop(tx, ["U1", "U2"]);
      await submitOnline(tx, s.id, "U1", high);
      const before = await dashboard(tx, s.id);
      const index = (d: typeof before) => d.summary.groups[0].metrics.map((m) => m.average);

      await staff.submitPublic(tx, { slug: s.publicSlug, versionId: version.id, answers: low, context: { repairOrder: "U2" }, requestKey: `k-${unique()}` });
      const pending = await dashboard(tx, s.id);
      expect(pending.summary.total).toBe(2);
      expect(pending.summary.counts).toMatchObject({ counted: 1, pending_match: 1 });
      expect(index(pending)).toEqual(index(before));

      const [pub] = await tx.select().from(surveyResponse).where(and(eq(surveyResponse.shopId, s.id), eq(surveyResponse.source, "public")));
      const [visit] = await tx.select().from(repairVisit).where(and(eq(repairVisit.shopId, s.id), eq(repairVisit.sourceVisitKey, "U2")));
      await staff.matchToVisit(tx, actor, pub.id, pub.matchRevision, visit.id, "RO matches");
      const matched = await dashboard(tx, s.id);
      expect(matched.summary.counts).toMatchObject({ counted: 2, pending_match: 0 });
      expect(index(matched)).not.toEqual(index(before));
    }));

  it("uses the corrected revision and keeps test data out of a production shop's scores (AT-20, AT-31)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await liveShop(tx, ["C1"]);
      const id = await submitOnline(tx, s.id, "C1", low);
      const first = (await dashboard(tx, s.id)).summary.groups[0].metrics[0].average;
      await staff.correctResponse(tx, actor, id, 1, high, "Rating misread");
      const corrected = await dashboard(tx, s.id);
      expect(corrected.summary.groups[0].metrics[0].average).not.toBe(first);
      expect(corrected.rows[0].revision).toBe(2);

      // A test paper entry in the same production shop is listed but never scored.
      await tx.update(shopSurveySettings).set({ mode: "test", liveSince: null }).where(eq(shopSurveySettings.shopId, s.id));
      await staff.submitPaper(tx, actor, { shopId: s.id, visitId: null, receivedOn: today, answers: low, requestKey: `k-${unique()}` });
      const withTest = await dashboard(tx, s.id);
      expect(withTest.summary.counts.excluded_test).toBe(1);
      expect(withTest.summary.counts.counted).toBe(1);
      expect(withTest.summary.groups[0].metrics[0].average).toBe(corrected.summary.groups[0].metrics[0].average);
    }));

  it("filters by an answer and reads each response's current answers with its scores (AT-31)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await liveShop(tx, ["F1", "F2"]);
      const lowId = await submitOnline(tx, s.id, "F1", low);
      const highId = await submitOnline(tx, s.id, "F2", high);
      const only = async (answer: string) => (await store.cohortRows(tx, s.id, parseFilters({ answer }, today), "America/Chicago", { withAnswers: false })).map((r) => r.id);
      expect(await only("overall_rating:lte:2")).toEqual([lowId]);
      expect(await only("service_aspects.communication:eq:excellent")).toEqual([highId]);
      expect(await only("ready_on_time:eq:maybe")).toEqual([]);

      // A correction changes which filter the response falls under, and the answers the results read.
      await staff.correctResponse(tx, actor, lowId, 1, high, "Rating misread");
      expect(await only("overall_rating:lte:2")).toEqual([]);
      const rows = await store.cohortRows(tx, s.id, filters, "America/Chicago");
      expect(rows.find((r) => r.id === lowId)?.answers).toMatchObject({ overall_rating: 5 });
    }));

  it("counts drafts separately and never scores them (SR-16)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await liveShop(tx, ["R1"]);
      const [row] = await tx.select({ id: invitation.id }).from(invitation).where(eq(invitation.shopId, s.id));
      const link = await invitations.issuePrintableLink(tx, actor, s.id, row.id);
      await responses.saveDraft(tx, link.token, 0, { overall_rating: 1 });
      expect(await store.draftCount(tx, s.id)).toBe(1);
      expect((await dashboard(tx, s.id)).summary.total).toBe(0);
    }));

  it("keeps historical responses read-only and their unlike scales apart (AT-30)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await liveShop(tx, []);
      await tx.insert(historicalResponse).values([
        { shopId: s.id, sourceSystem: "supabase", sourceRef: `h-${unique()}`, respondedOn: today, measures: { csi: { value: 9, scale: "0-10" }, emi: { value: 0.8, scale: "fraction" } } },
        { shopId: s.id, sourceSystem: "supabase", sourceRef: `h-${unique()}`, respondedOn: today, measures: { csi: { value: 7, scale: "0-10" }, emi: { value: null, scale: "fraction" } } },
      ]);
      const history = await store.historicalSummary(tx, s.id, filters.from, filters.to);
      expect(history.responses).toBe(2);
      expect(history.measures).toEqual(
        expect.arrayContaining([
          { key: "csi", scale: "0-10", average: 8, n: 2 },
          { key: "emi", scale: "fraction", average: 0.8, n: 1 },
        ]),
      );
      await expect(tx.transaction((inner) => inner.update(historicalResponse).set({ respondedOn: "2020-01-01" }).where(eq(historicalResponse.shopId, s.id)))).rejects.toThrow();
    }));
});
