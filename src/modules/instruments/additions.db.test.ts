/**
 * Database tests for shop additions (SR-45, AT-45): a shop's own questions
 * appear only where configured, never change shared scores, stay pinned to
 * issued invitations and keep their stable ids. Every test rolls back.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("shop additions", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { invitation, repairVisit, shop, shopSurveySettings, surveyResponse, responseRevision } = await import("@/db/schema");
  const instruments = await import("./store");
  const { demoDefinition } = await import("./demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const imports = await import("@/modules/imports/store");
  const invitations = await import("@/modules/invitations/store");
  const responses = await import("@/modules/responses/store");
  const staff = await import("@/modules/responses/staff-store");
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

  const core = { overall_rating: 2, ready_on_time: "yes", service_aspects: { communication: "fair", quality: "good", cleanliness: "good" }, recommend_score: 6 };
  const additionPages = [
    {
      id: "add_page_1",
      title: "A few questions from the shop",
      questions: [
        { id: "add_parking", type: "single_choice", title: "Was parking easy?", display: "radio", required: true, choices: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
        { id: "add_comment", type: "text", title: "Anything else for us?", multiline: true, maxLength: 500, required: false },
      ],
    },
  ];

  /** A shop in Test mode with a published core version; production data needs a verified one. */
  async function shopWithCore(tx: Tx, verified = true) {
    const [s] = await tx.insert(shop).values({ name: `Addition Shop ${unique()}`, publicSlug: `add-${unique().replace("_", "-")}` }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    const { draft } = await instruments.insertInstrument(tx, system, { key: `core_${unique()}`, name: "Core" }, demoDefinition);
    const version = await instruments.publishVersion(tx, system, draft.id, draft.revision, { isTest: !verified, sourceNote: "Approved export" });
    await settings.updateSettings(
      tx,
      system,
      s.id,
      1,
      settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-01-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: [], logoUrl: "", brandColor: "" }),
    );
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: new Date() }).where(eq(shopSurveySettings.shopId, s.id));
    return { shop: s, core: version };
  }

  async function publishAddition(tx: Tx, shopId: string, pages: unknown = additionPages, isTest = false) {
    const created = await instruments.createShopAddition(tx, system, shopId);
    const found = await instruments.findInstrument(tx, created.id);
    let draft = found!.versions.find((v) => v.status === "draft");
    if (!draft) draft = await instruments.createDraftFrom(tx, system, found!.versions[0].id);
    const saved = await instruments.saveDraft(tx, system, draft.id, draft.revision, { schemaVersion: 1, pages, metrics: [], alerts: [], suppressions: [] });
    return instruments.publishVersion(tx, system, saved.id, saved.revision, { isTest, sourceNote: "Shop request, approved by PSG" });
  }

  /** Run a write that must fail in a savepoint, and return the database's own message. */
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

  const goLive = async (tx: Tx, shopId: string) => settings.changeMode(tx, system, shopId, await revision(tx, shopId), "live");

  const revision = async (tx: Tx, shopId: string) => (await tx.select({ r: shopSurveySettings.revision }).from(shopSurveySettings).where(eq(shopSurveySettings.shopId, shopId)))[0].r;

  async function importVisit(tx: Tx, shopId: string, key: string) {
    const batch = await imports.createBatch(tx, system, { shopId, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "a.csv", content: `RO,Last Name,Delivered On\n${key},Smith,2026-09-10` });
    await imports.commitBatch(tx, system, batch.id, batch.revision);
    const [row] = await tx.select({ id: invitation.id, additionVersionId: invitation.additionVersionId, visitId: invitation.visitId }).from(invitation).innerJoin(repairVisit, eq(repairVisit.id, invitation.visitId)).where(and(eq(repairVisit.shopId, shopId), eq(repairVisit.sourceVisitKey, key)));
    return row;
  }

  afterAll(async () => {
    await getPool().end();
  });

  it("keeps one questions survey per shop, with add_ ids and no scoring rules", () =>
    inRollback(async (tx) => {
      const { shop: s } = await shopWithCore(tx);
      const first = await instruments.createShopAddition(tx, system, s.id);
      expect(first.shopId).toBe(s.id);
      expect((await instruments.createShopAddition(tx, system, s.id)).id).toBe(first.id);

      const found = await instruments.findInstrument(tx, first.id);
      const draft = found!.versions[0];
      const bad = await instruments.saveDraft(tx, system, draft.id, draft.revision, { schemaVersion: 1, pages: [{ id: "add_page_1", questions: [{ id: "parking", type: "text", title: "Parking?" }] }], metrics: [], alerts: [], suppressions: [] });
      await expect(instruments.publishVersion(tx, system, bad.id, bad.revision, { isTest: true })).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('must start with "add_"') })]) });

      const scored = await instruments.saveDraft(tx, system, bad.id, bad.revision, {
        schemaVersion: 1,
        pages: additionPages,
        metrics: [{ id: "add_score", label: "Score", method: "sum", items: [{ question: "add_parking" }] }],
        alerts: [],
        suppressions: [],
      });
      await expect(instruments.publishVersion(tx, system, scored.id, scored.revision, { isTest: true })).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("never change the shared scores") })]) });

      // The shared core can never use the prefix kept for shop questions.
      const { draft: coreDraft } = await instruments.insertInstrument(tx, system, { key: `core_bad_${unique()}`, name: "Core" }, { schemaVersion: 1, pages: [{ id: "p1", questions: [{ id: "add_x", type: "text", title: "X" }] }] });
      await expect(instruments.publishVersion(tx, system, coreDraft.id, coreDraft.revision, { isTest: true })).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("kept for shop questions") })]) });
    }));

  it("assigns only the shop's own questions, never as the core, and never TEST content outside Test mode", () =>
    inRollback(async (tx) => {
      const a = await shopWithCore(tx);
      const b = await shopWithCore(tx);
      const addA = await publishAddition(tx, a.shop.id);
      const testB = await publishAddition(tx, b.shop.id, additionPages, true);

      await expect(settings.setAdditionVersion(tx, system, b.shop.id, await revision(tx, b.shop.id), addA.id)).rejects.toMatchObject({ kind: "invalid" });
      expect(await settings.listAssignableVersions(tx)).not.toContainEqual(expect.objectContaining({ id: addA.id }));
      // The database refuses it too, however the row is written (a nested transaction is a savepoint).
      expect(await dbError(tx, (sp) => sp.update(shopSurveySettings).set({ instrumentVersionId: addA.id }).where(eq(shopSurveySettings.shopId, a.shop.id)))).toMatch(/cannot be assigned as the core survey/);
      expect(await dbError(tx, (sp) => sp.update(shopSurveySettings).set({ additionVersionId: addA.id }).where(eq(shopSurveySettings.shopId, b.shop.id)))).toMatch(/its own additional questions/);

      // TEST questions are fine while testing, refused once the shop is Live.
      await settings.setAdditionVersion(tx, system, b.shop.id, await revision(tx, b.shop.id), testB.id);
      await settings.setAdditionVersion(tx, system, b.shop.id, await revision(tx, b.shop.id), null);
      await settings.changeMode(tx, system, b.shop.id, await revision(tx, b.shop.id), "live");
      await expect(settings.setAdditionVersion(tx, system, b.shop.id, await revision(tx, b.shop.id), testB.id)).rejects.toMatchObject({ kind: "invalid" });
    }));

  it("shows the shop's questions after the core, stores their answers, and leaves shared scores unchanged (AT-45)", () =>
    inRollback(async (tx) => {
      const plain = await shopWithCore(tx);
      const withQuestions = await shopWithCore(tx);
      const addition = await publishAddition(tx, withQuestions.shop.id);
      await settings.setAdditionVersion(tx, system, withQuestions.shop.id, await revision(tx, withQuestions.shop.id), addition.id);
      await goLive(tx, plain.shop.id);
      await goLive(tx, withQuestions.shop.id);

      const invPlain = await importVisit(tx, plain.shop.id, "P1");
      const invExtra = await importVisit(tx, withQuestions.shop.id, "X1");
      expect(invPlain.additionVersionId).toBeNull();
      expect(invExtra.additionVersionId).toBe(addition.id);

      const linkPlain = await invitations.issuePrintableLink(tx, system, plain.shop.id, invPlain.id);
      const linkExtra = await invitations.issuePrintableLink(tx, system, withQuestions.shop.id, invExtra.id);
      const statePlain = await responses.getTokenState(tx, linkPlain.token);
      const stateExtra = await responses.getTokenState(tx, linkExtra.token);
      if (statePlain.state !== "open" || stateExtra.state !== "open") throw new Error("expected open surveys");
      // Appears only where configured, after the shared pages.
      expect(statePlain.context.definition.pages.map((p) => p.id)).not.toContain("add_page_1");
      expect(stateExtra.context.definition.pages.map((p) => p.id).at(-1)).toBe("add_page_1");

      // A shop without questions refuses their answers; the shop with them requires its required one.
      expect(await responses.submitResponse(tx, linkPlain.token, `k-${unique()}`, { ...core, add_parking: "yes" })).toMatchObject({ ok: false, reason: "invalid" });
      expect(await responses.submitResponse(tx, linkExtra.token, `k-${unique()}`, core)).toMatchObject({ ok: false, reason: "invalid" });

      const a = await responses.submitResponse(tx, linkPlain.token, `k-${unique()}`, core);
      const b = await responses.submitResponse(tx, linkExtra.token, `k-${unique()}`, { ...core, add_parking: "no", add_comment: "Lot was full" });
      if (!a.ok || !b.ok) throw new Error("submit failed");
      // Same shared answers, same shared scores and alerts, with or without shop questions.
      expect(b.outcomes.metrics).toEqual(a.outcomes.metrics);
      expect(b.outcomes.alerts).toEqual(a.outcomes.alerts);

      const [stored] = await tx.select({ additionVersionId: surveyResponse.additionVersionId }).from(surveyResponse).where(eq(surveyResponse.id, b.responseId));
      expect(stored.additionVersionId).toBe(addition.id);
      const [rev] = await tx.select({ answers: responseRevision.answers }).from(responseRevision).where(eq(responseRevision.responseId, b.responseId));
      expect(rev.answers).toMatchObject({ add_parking: "no", add_comment: "Lot was full" });
    }));

  it("keeps issued invitations on the questions they were sent with (SR-15)", () =>
    inRollback(async (tx) => {
      const s = await shopWithCore(tx);
      const v1 = await publishAddition(tx, s.shop.id);
      await settings.setAdditionVersion(tx, system, s.shop.id, await revision(tx, s.shop.id), v1.id);
      const issued = await importVisit(tx, s.shop.id, "V1");
      const v2 = await publishAddition(tx, s.shop.id, [{ id: "add_page_1", questions: [{ id: "add_wait", type: "text", title: "How was the wait?" }] }]);
      await settings.setAdditionVersion(tx, system, s.shop.id, await revision(tx, s.shop.id), v2.id);
      const later = await importVisit(tx, s.shop.id, "V2");
      expect(issued.additionVersionId).toBe(v1.id);
      expect(later.additionVersionId).toBe(v2.id);

      // A paper form for the first visit uses its pinned questions, not the newer ones.
      const paper = await staff.paperFormContext(tx, s.shop.id, issued.visitId);
      expect(paper?.definition?.pages.flatMap((p) => p.questions.map((q) => q.id))).toContain("add_parking");
      expect(paper?.definition?.pages.flatMap((p) => p.questions.map((q) => q.id))).not.toContain("add_wait");
    }));

  it("refuses a public form answered against questions that changed meanwhile", () =>
    inRollback(async (tx) => {
      const s = await shopWithCore(tx);
      const addition = await publishAddition(tx, s.shop.id);
      const before = await staff.publicShopForm(tx, s.shop.publicSlug);
      await settings.setAdditionVersion(tx, system, s.shop.id, await revision(tx, s.shop.id), addition.id);
      const stale = await staff.submitPublic(tx, { slug: s.shop.publicSlug, versionId: before!.versionId, additionVersionId: before!.additionVersionId, answers: core, context: {}, requestKey: `k-${unique()}` });
      expect(stale).toMatchObject({ ok: false, reason: "changed" });
      const now = await staff.publicShopForm(tx, s.shop.publicSlug);
      expect(now!.additionVersionId).toBe(addition.id);
      const saved = await staff.submitPublic(tx, { slug: s.shop.publicSlug, versionId: now!.versionId, additionVersionId: now!.additionVersionId, answers: { ...core, add_parking: "yes" }, context: {}, requestKey: `k-${unique()}` });
      expect(saved).toMatchObject({ ok: true });
    }));
});
