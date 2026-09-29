/**
 * Database tests for negative alerts, Approve & Send, follow-up and the
 * interim suppression queue (SR-32..SR-36). Every test rolls back.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("alerts, cases and suppression", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { alertApproval, alertCase, emailIntent, invitation, repairVisit, shop, shopSurveySettings, suppressionAction, surveyResponse, testRecipientAllowlist } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const imports = await import("@/modules/imports/store");
  const invitations = await import("@/modules/invitations/store");
  const responses = await import("@/modules/responses/store");
  const staff = await import("@/modules/responses/staff-store");
  const ledger = await import("@/modules/email-ledger/store");
  const cases = await import("./store");
  type Tx = import("@/db/client").Tx;

  const actor = { type: "system" } as const;
  const links = { appUrl: "https://survey.test", optOutSecret: "test-secret" };
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

  const low = { overall_rating: 1, ready_on_time: "no", delay_detail: "Late", service_aspects: { communication: "poor", quality: "poor", cleanliness: "poor" }, recommend_score: 1 };
  const high = { overall_rating: 5, ready_on_time: "yes", service_aspects: { communication: "excellent", quality: "excellent", cleanliness: "excellent" }, recommend_score: 10 };

  /** A Live production shop with saved alert recipients and imported visits. */
  async function liveShop(tx: Tx, keys: string[], saved = ["owner@shop.example"]) {
    const [s] = await tx.insert(shop).values({ name: "Case Shop", publicSlug: `case-${unique().replace("_", "-")}` }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    const { draft } = await instruments.insertInstrument(tx, actor, { key: `case_${unique()}`, name: "Demo" }, demoDefinition);
    const version = await instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest: false, sourceNote: "Approved export, checksum abc" });
    const saved1 = await settings.updateSettings(
      tx,
      actor,
      s.id,
      1,
      settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-01-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: saved, logoUrl: "", brandColor: "" }),
    );
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: new Date() }).where(eq(shopSurveySettings.shopId, s.id));
    await settings.changeMode(tx, actor, s.id, saved1.revision, "live");
    if (keys.length > 0) {
      const content = ["RO,Last Name,Delivered On", ...keys.map((k) => `${k},Smith,2026-09-10`)].join("\n");
      const batch = await imports.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "c.csv", content });
      await imports.commitBatch(tx, actor, batch.id, batch.revision);
    }
    return { shop: s, version };
  }

  async function submitOnline(tx: Tx, shopId: string, key: string, answers: unknown) {
    const [row] = await tx.select({ id: invitation.id }).from(invitation).innerJoin(repairVisit, eq(repairVisit.id, invitation.visitId)).where(and(eq(repairVisit.shopId, shopId), eq(repairVisit.sourceVisitKey, key)));
    const link = await invitations.issuePrintableLink(tx, actor, shopId, row.id);
    const result = await responses.submitResponse(tx, link.token, `k-${unique()}`, answers);
    if (!result.ok) throw new Error("submit failed");
    return result.responseId;
  }

  const caseFor = async (tx: Tx, responseId: string) => (await tx.select().from(alertCase).where(eq(alertCase.responseId, responseId)))[0];
  const alertIntents = async (tx: Tx, caseId: string) =>
    tx.select({ intent: emailIntent }).from(emailIntent).innerJoin(alertApproval, eq(alertApproval.id, emailIntent.alertApprovalId)).where(eq(alertApproval.caseId, caseId));

  /** Dispatch the given intents inside the test transaction; returns the messages "sent". */
  async function dispatch(tx: Tx, intentIds: string[]) {
    const sent: { to: string; subject: string; text: string }[] = [];
    for (;;) {
      const p = await ledger.prepareNext(tx, "w", links, new Date(), { intentIds });
      if (p.kind === "none") return sent;
      if (p.kind === "send") {
        sent.push(p.message);
        await ledger.recordOutcome(tx, p.intentId, p.tokenId, "w", { result: "accepted", providerMessageId: `m-${unique()}` }, new Date());
      }
    }
  }

  afterAll(async () => {
    await getPool().end();
  });

  it("a negative submission creates a PSG review item and zero shop emails (AT-32)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await liveShop(tx, ["N1", "N2"]);
      const bad = await submitOnline(tx, s.id, "N1", low);
      const good = await submitOnline(tx, s.id, "N2", high);
      const c = await caseFor(tx, bad);
      expect(c).toMatchObject({ status: "pending_review", followUp: "none", shopId: s.id });
      expect((c.alerts as { id: string }[]).map((a) => a.id)).toEqual(["low_overall", "low_service_index", "not_on_time"]);
      expect(await caseFor(tx, good)).toBeUndefined();
      expect(await alertIntents(tx, c.id)).toHaveLength(0);
      // The result is visible to the shop straight away regardless.
      const [resp] = await tx.select().from(surveyResponse).where(eq(surveyResponse.id, bad));
      expect(resp.canonical).toBe(true);
    }));

  it("Approve & Send snapshots recipients without changing the saved list, once, with delivery per recipient (AT-33)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await liveShop(tx, ["A1"], ["owner@shop.example", "manager@shop.example"]);
      const c = await caseFor(tx, await submitOnline(tx, s.id, "A1", low));
      const approval = await cases.approveAndSend(tx, actor, c.id, c.revision, ["owner@shop.example", "Service@Shop.example"], "Customer upset about delay");
      expect(approval.recipients).toEqual(["owner@shop.example", "service@shop.example"]);
      expect(approval.savedRecipients).toEqual(["owner@shop.example", "manager@shop.example"]);
      const [saved] = await tx.select({ list: shopSurveySettings.alertRecipients }).from(shopSurveySettings).where(eq(shopSurveySettings.shopId, s.id));
      expect(saved.list).toEqual(["owner@shop.example", "manager@shop.example"]);

      // A retried (stale) approval does not duplicate the sends.
      await expect(cases.approveAndSend(tx, actor, c.id, c.revision, ["owner@shop.example"], "")).rejects.toMatchObject({ kind: "conflict" });
      const intents = await alertIntents(tx, c.id);
      expect(intents.map((i) => i.intent.recipient).sort()).toEqual(["owner@shop.example", "service@shop.example"]);

      const sent = await dispatch(
        tx,
        intents.map((i) => i.intent.id),
      );
      expect(sent.map((m) => m.to).sort()).toEqual(["owner@shop.example", "service@shop.example"]);
      expect(sent[0].text).toContain(`/shop/${s.id}/responses/`);
      expect(sent[0].text).toContain("Low overall satisfaction (demo)");
      const full = await cases.getCase(tx, c.id);
      expect(full?.deliveries.map((d) => d.state)).toEqual(["accepted", "accepted"]);
      expect(full?.case).toMatchObject({ status: "approved", followUp: "open" });
      expect(await dispatch(tx, intents.map((i) => i.intent.id))).toHaveLength(0);
    }));

  it("an unknown shop must be confirmed before outreach; test alerts reach only internal addresses", () =>
    inRollback(async (tx) => {
      const { shop: s, version } = await liveShop(tx, []);
      const [orphan] = await tx
        .insert(surveyResponse)
        .values({ instrumentVersionId: version.id, source: "paper", status: "submitted", isTest: false, submittedAt: new Date(), submitPayloadHash: "x", matchStatus: "shop_unconfirmed" })
        .returning();
      await tx.insert((await import("@/db/schema")).responseRevision).values({ responseId: orphan.id, revision: 1, answers: low, outcomes: { evaluatorVersion: 1, metrics: {}, alerts: [{ id: "low_overall", label: "Low", precedence: 1 }], suppressions: [] }, definitionHash: "x", evaluatorVersion: 1, actorType: "system" });
      await cases.raiseForSubmission(tx, orphan.id);
      const c = await caseFor(tx, orphan.id);
      await expect(cases.approveAndSend(tx, actor, c.id, c.revision, ["owner@shop.example"], "")).rejects.toMatchObject({ kind: "invalid" });
      await staff.confirmShop(tx, actor, orphan.id, orphan.matchRevision, s.id, "Company name matches");
      expect((await caseFor(tx, orphan.id)).shopId).toBe(s.id);

      // A test case (internal test shop) may only email allowlisted addresses.
      const [testShop] = await tx.insert(shop).values({ name: "QA", publicSlug: `qa-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      const [testResp] = await tx
        .insert(surveyResponse)
        .values({ shopId: testShop.id, instrumentVersionId: version.id, source: "paper", status: "submitted", isTest: true, submittedAt: new Date(), submitPayloadHash: "x", matchStatus: "visit_unmatched" })
        .returning();
      const [tc] = await tx.insert(alertCase).values({ responseId: testResp.id, shopId: testShop.id, isTest: true, alerts: [{ id: "low_overall", label: "Low", precedence: 1 }], sourceRevision: 1 }).returning();
      await settings.insertDefaultSettings(tx, testShop.id);
      const domain = `@qa-${unique().replace("_", "-")}.example`;
      await tx.insert(testRecipientAllowlist).values({ entry: domain });
      await cases.approveAndSend(tx, actor, tc.id, tc.revision, [`qa${domain}`, "owner@realshop.com"], "");
      const sent = await dispatch(
        tx,
        (await alertIntents(tx, tc.id)).map((i) => i.intent.id),
      );
      expect(sent.map((m) => m.to)).toEqual([`qa${domain}`]);
      expect(sent[0].subject.startsWith("[TEST]")).toBe(true);
      const blocked = (await alertIntents(tx, tc.id)).find((i) => i.intent.recipient === "owner@realshop.com");
      expect(blocked?.intent).toMatchObject({ state: "cancelled", stateReason: "TEST_RECIPIENT_NOT_ALLOWED" });
    }));

  it("a dismissed case sends nothing and the shop never sees it as a case", () =>
    inRollback(async (tx) => {
      const { shop: s } = await liveShop(tx, ["D1"]);
      const c = await caseFor(tx, await submitOnline(tx, s.id, "D1", low));
      await expect(cases.dismissCase(tx, actor, c.id, c.revision, "")).rejects.toMatchObject({ kind: "invalid" });
      await cases.dismissCase(tx, actor, c.id, c.revision, "Customer already called and it is handled");
      expect(await cases.listShopCases(tx, s.id, 0, 25)).toHaveLength(0);
      expect(await cases.countShopCases(tx, s.id)).toBe(0);
      expect(await cases.getShopCase(tx, s.id, c.id)).toBeNull();
    }));

  it("a shop closure request stays open until PSG resolves it; internal notes stay internal (AT-34)", () =>
    inRollback(async (tx) => {
      const a = await liveShop(tx, ["F1"]);
      const b = await liveShop(tx, []);
      const c = await caseFor(tx, await submitOnline(tx, a.shop.id, "F1", low));
      await cases.approveAndSend(tx, actor, c.id, c.revision, ["owner@shop.example"], "");
      let current = (await caseFor(tx, c.responseId))!;

      await cases.addNote(tx, actor, c.id, { body: "Called the customer, left a message", visibility: "shop", authorKind: "shop" });
      await cases.addNote(tx, actor, c.id, { body: "Shop has a history of late repairs", visibility: "internal", authorKind: "psg" });
      await expect(cases.addNote(tx, actor, c.id, { body: "sneaky", visibility: "internal", authorKind: "shop" })).rejects.toMatchObject({ kind: "invalid" });
      await cases.requestClosure(tx, actor, c.id, current.revision, "Customer accepted a free detail");
      current = (await caseFor(tx, c.responseId))!;
      expect(current).toMatchObject({ followUp: "closure_requested", resolvedAt: null });

      const shopView = await cases.getShopCase(tx, a.shop.id, c.id);
      expect(shopView?.notes.map((n) => n.note.body)).toEqual(["Called the customer, left a message", "Closure requested: Customer accepted a free detail"]);
      expect(await cases.getShopCase(tx, b.shop.id, c.id)).toBeNull();

      await expect(cases.resolveCase(tx, actor, c.id, current.revision, "nope" as never, "")).rejects.toMatchObject({ kind: "invalid" });
      await cases.resolveCase(tx, actor, c.id, current.revision, "resolved_with_customer", "Confirmed with the customer by phone");
      const resolved = await cases.getCase(tx, c.id);
      expect(resolved?.case).toMatchObject({ followUp: "resolved", resolutionOutcome: "resolved_with_customer" });
      expect(resolved?.case.resolvedAt).not.toBeNull();
      expect(resolved?.notes).toHaveLength(4);
    }));

  it("a correction after approval returns the case to review and sends nothing by itself (AT-20)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await liveShop(tx, ["R1"]);
      const responseId = await submitOnline(tx, s.id, "R1", low);
      const c = await caseFor(tx, responseId);
      await cases.approveAndSend(tx, actor, c.id, c.revision, ["owner@shop.example"], "");
      await cases.addNote(tx, actor, c.id, { body: "Called the customer back", visibility: "shop", authorKind: "shop" });
      const result = await staff.correctResponse(tx, actor, responseId, 1, { ...low, ready_on_time: "yes", delay_detail: undefined }, "Customer said the car was on time");
      expect(result.alertsChanged).toBe(true);
      const after = await caseFor(tx, responseId);
      expect(after.status).toBe("pending_review");
      expect(after.outcomeChangedAt).not.toBeNull();
      expect((after.alerts as { id: string }[]).map((a) => a.id)).not.toContain("not_on_time");
      expect(await alertIntents(tx, c.id)).toHaveLength(1);
      // The shop keeps its case, notes and history while PSG reviews again, and after a dismissal (SR-34).
      expect((await cases.getShopCase(tx, s.id, c.id))?.notes.map((n) => n.note.body)).toEqual(["Called the customer back"]);
      expect(await cases.countShopCases(tx, s.id)).toBe(1);
      await cases.dismissCase(tx, actor, c.id, after.revision, "The corrected answers need no outreach");
      expect(await cases.getShopCase(tx, s.id, c.id)).not.toBeNull();
      expect(await cases.listShopCases(tx, s.id, 0, 25)).toHaveLength(1);
    }));

  it("the suppression queue needs an identified change, records the operator, and a reversal is a new action (AT-36)", () =>
    inRollback(async (tx) => {
      const { shop: s, version } = await liveShop(tx, ["S1"]);
      const responseId = await submitOnline(tx, s.id, "S1", low);
      const [apply] = await tx.select().from(suppressionAction).where(eq(suppressionAction.responseId, responseId));
      expect(apply).toMatchObject({ desired: "apply", status: "outstanding", ruleId: "hold_routine_mail" });

      await expect(cases.acknowledgeSuppression(tx, actor, apply.id, apply.revision, "applied", "")).rejects.toMatchObject({ kind: "invalid" });
      await cases.acknowledgeSuppression(tx, actor, apply.id, apply.revision, "applied", "Set routine mail hold on FileMaker record 1042");
      await expect(cases.acknowledgeSuppression(tx, actor, apply.id, apply.revision + 1, "applied", "again please")).rejects.toMatchObject({ kind: "conflict" });
      await expect(tx.transaction((inner) => inner.update(suppressionAction).set({ status: "outstanding" }).where(eq(suppressionAction.id, apply.id)))).rejects.toThrow();

      await staff.correctResponse(tx, actor, responseId, 1, high, "Rating was misread");
      const actions = await tx.select().from(suppressionAction).where(eq(suppressionAction.responseId, responseId));
      expect(actions.map((a) => `${a.desired}:${a.status}`).sort()).toEqual(["apply:acknowledged", "remove:outstanding"]);

      // An unmatched response's change cannot be acknowledged until its visit is known.
      await staff.submitPublic(tx, { slug: s.publicSlug, versionId: version.id, answers: low, context: {}, requestKey: `k-${unique()}` });
      const [pub] = await tx.select().from(surveyResponse).where(and(eq(surveyResponse.shopId, s.id), eq(surveyResponse.source, "public")));
      const [pending] = await tx.select().from(suppressionAction).where(eq(suppressionAction.responseId, pub.id));
      await expect(cases.acknowledgeSuppression(tx, actor, pending.id, pending.revision, "applied", "Applied somewhere")).rejects.toMatchObject({ kind: "invalid" });
    }));
});
