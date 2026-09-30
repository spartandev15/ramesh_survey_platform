/**
 * Database tests for paper entry, public responses, matching, duplicates and
 * corrections (SR-13, SR-18..SR-20, SR-28, SR-29). Every test rolls back.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("staff and public responses", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { alertCase, auditEvent, emailIntent, invitation, matchDecision, repairVisit, responseRevision, shop, shopSuggestion, shopSurveySettings, surveyResponse } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const imports = await import("@/modules/imports/store");
  const invitations = await import("@/modules/invitations/store");
  const responses = await import("./store");
  const staff = await import("./staff-store");
  const dashboard = await import("@/modules/dashboard/store");
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

  const complete = {
    overall_rating: 2,
    ready_on_time: "no",
    delay_detail: "Two days late",
    service_aspects: { communication: "fair", quality: "good", cleanliness: "good" },
    recommend_score: 6,
  };
  const happy = { ...complete, overall_rating: 5, ready_on_time: "yes", delay_detail: undefined, recommend_score: 10 };
  delete (happy as Record<string, unknown>).delay_detail;

  /** A Live production shop with visits imported from CSV rows "key,first,last,email". */
  async function shopWithVisits(tx: Tx, rows: string[]) {
    const [s] = await tx.insert(shop).values({ name: "Match Shop", publicSlug: `match-${unique().replace("_", "-")}` }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    const { draft } = await instruments.insertInstrument(tx, actor, { key: `match_${unique()}`, name: "Demo" }, demoDefinition);
    const version = await instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest: false, sourceNote: "Approved export, checksum abc" });
    const saved = await settings.updateSettings(
      tx,
      actor,
      s.id,
      1,
      settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-10-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: [], logoUrl: "", brandColor: "" }),
    );
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: new Date() }).where(eq(shopSurveySettings.shopId, s.id));
    await settings.changeMode(tx, actor, s.id, saved.revision, "live");
    const content = ["RO,First Name,Last Name,Email,Delivered On", ...rows.map((r) => `${r},2026-10-02`)].join("\n");
    const batch = await imports.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "v.csv", content });
    await imports.commitBatch(tx, actor, batch.id, batch.revision);
    const visits = await tx.select().from(repairVisit).where(eq(repairVisit.shopId, s.id));
    const visit = (key: string) => visits.find((v) => v.sourceVisitKey === key)!;
    return { shop: s, version, visit };
  }

  const responseRow = async (tx: Tx, id: string) => (await tx.select().from(surveyResponse).where(eq(surveyResponse.id, id)))[0];
  const countedFor = async (tx: Tx, visitId: string) => tx.select().from(surveyResponse).where(and(eq(surveyResponse.visitId, visitId), eq(surveyResponse.canonical, true)));

  afterAll(async () => {
    await getPool().end();
  });

  it("paper and identical online answers score the same; paper provenance is audited (AT-18)", () =>
    inRollback(async (tx) => {
      const { shop: s, visit } = await shopWithVisits(tx, ["P1,Jo,Smith,jo@example.com", "P2,Al,Lee,al@example.com"]);
      const paper = await staff.submitPaper(tx, actor, { shopId: s.id, visitId: visit("P1").id, receivedOn: "2026-09-20", answers: complete, requestKey: `k-${unique()}` });
      const [inv] = await tx.select().from(invitation).where(eq(invitation.visitId, visit("P2").id));
      const link = await invitations.issuePrintableLink(tx, actor, s.id, inv.id);
      const online = await responses.submitResponse(tx, link.token, `k-${unique()}`, complete);
      expect(online.ok).toBe(true);

      const [paperRev] = await tx.select().from(responseRevision).where(eq(responseRevision.responseId, paper.responseId));
      const [onlineRev] = await tx.select().from(responseRevision).where(eq(responseRevision.responseId, (online as { responseId: string }).responseId));
      expect(paperRev.outcomes).toEqual(onlineRev.outcomes);
      expect(paperRev.definitionHash).toBe(onlineRev.definitionHash);

      const row = await responseRow(tx, paper.responseId);
      expect(row).toMatchObject({ source: "paper", receivedOn: "2026-09-20", canonical: true, matchStatus: "matched" });
      const [audit] = await tx.select().from(auditEvent).where(and(eq(auditEvent.subjectId, paper.responseId), eq(auditEvent.action, "response.paper_entered")));
      expect(audit.after).toMatchObject({ source: "paper", receivedOn: "2026-09-20" });
      // The paper response stops the visit's pending reminder and initial send.
      const replay = await staff.submitPaper(tx, actor, { shopId: s.id, visitId: visit("P1").id, receivedOn: "2026-09-20", answers: complete, requestKey: row.submitRequestKey! });
      expect(replay).toEqual({ responseId: paper.responseId, replayed: true });
      // The same key with different answers is refused, never saved as a second entry.
      await expect(staff.submitPaper(tx, actor, { shopId: s.id, visitId: visit("P1").id, receivedOn: "2026-09-20", answers: happy, requestKey: row.submitRequestKey! })).rejects.toMatchObject({ kind: "conflict" });
    }));

  it("the first submission for a visit counts; a later one waits for duplicate review (AT-19)", () =>
    inRollback(async (tx) => {
      const { shop: s, visit } = await shopWithVisits(tx, ["D1,Jo,Smith,jo@example.com"]);
      const [inv] = await tx.select().from(invitation).where(eq(invitation.visitId, visit("D1").id));
      const link = await invitations.issuePrintableLink(tx, actor, s.id, inv.id);
      const online = (await responses.submitResponse(tx, link.token, `k-${unique()}`, complete)) as { responseId: string };
      const paper = await staff.submitPaper(tx, actor, { shopId: s.id, visitId: visit("D1").id, receivedOn: "2026-09-20", answers: happy, requestKey: `k-${unique()}` });

      expect(await responseRow(tx, online.responseId)).toMatchObject({ canonical: true, matchStatus: "matched" });
      const dup = await responseRow(tx, paper.responseId);
      expect(dup).toMatchObject({ canonical: false, matchStatus: "duplicate_review" });
      expect(await countedFor(tx, visit("D1").id)).toHaveLength(1);

      // Promote the paper one: exactly one counted response before and after.
      await expect(staff.resolveDuplicate(tx, actor, paper.responseId, dup.matchRevision, "promote", "")).rejects.toMatchObject({ kind: "invalid" });
      await staff.resolveDuplicate(tx, actor, paper.responseId, dup.matchRevision, "promote", "Customer confirmed the paper form is theirs");
      const counted = await countedFor(tx, visit("D1").id);
      expect(counted.map((c) => c.id)).toEqual([paper.responseId]);
      expect(await responseRow(tx, online.responseId)).toMatchObject({ canonical: false, duplicateDisposition: "promoted_other" });
      // Only one counted response can ever exist for a visit, whatever writes it.
      await expect(tx.transaction((inner) => inner.update(surveyResponse).set({ canonical: true }).where(eq(surveyResponse.id, online.responseId)))).rejects.toThrow();
    }));

  it("concurrent online and paper submits leave one counted result plus a review item (AT-19)", async () => {
    // Needs two real transactions, so it commits test-only data in an internal test shop.
    const setup = await getDb().transaction(async (tx) => {
      const [s] = await tx.insert(shop).values({ name: "E2E Duplicate Race (internal test)", publicSlug: `race-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      await settings.insertDefaultSettings(tx, s.id);
      const { draft } = await instruments.insertInstrument(tx, actor, { key: `race_${unique()}`, name: "Demo" }, demoDefinition);
      const version = await instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });
      await tx.update(shopSurveySettings).set({ instrumentVersionId: version.id }).where(eq(shopSurveySettings.shopId, s.id));
      const batch = await imports.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: true, sourceSystem: "shop_documents", fileName: "r.csv", content: "RO,Delivered On\nR1,2026-10-02" });
      await imports.commitBatch(tx, actor, batch.id, batch.revision);
      const [visit] = await tx.select().from(repairVisit).where(eq(repairVisit.shopId, s.id));
      const [inv] = await tx.select().from(invitation).where(eq(invitation.visitId, visit.id));
      const link = await invitations.issuePrintableLink(tx, actor, s.id, inv.id);
      return { shopId: s.id, visitId: visit.id, token: link.token };
    });
    await Promise.all([
      getDb().transaction((tx) => responses.submitResponse(tx, setup.token, `k-${unique()}`, complete)),
      getDb().transaction((tx) => staff.submitPaper(tx, actor, { shopId: setup.shopId, visitId: setup.visitId, receivedOn: "2026-09-20", answers: complete, requestKey: `k-${unique()}` })),
    ]);
    const all = await getDb().select().from(surveyResponse).where(eq(surveyResponse.visitId, setup.visitId));
    expect(all).toHaveLength(2);
    expect(all.filter((r) => r.canonical)).toHaveLength(1);
    expect(all.filter((r) => r.matchStatus === "duplicate_review")).toHaveLength(1);
  });

  it("a double-clicked public submit saves one response and one alert case, even when both requests run at once", async () => {
    // Needs two real transactions, so it commits test-only data in an internal test shop.
    const setup = await getDb().transaction(async (tx) => {
      const [s] = await tx.insert(shop).values({ name: "E2E Public Race (internal test)", publicSlug: `pubrace-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      await settings.insertDefaultSettings(tx, s.id);
      const { draft } = await instruments.insertInstrument(tx, actor, { key: `pubrace_${unique()}`, name: "Demo" }, demoDefinition);
      const version = await instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });
      await tx.update(shopSurveySettings).set({ instrumentVersionId: version.id }).where(eq(shopSurveySettings.shopId, s.id));
      return { shopId: s.id, slug: s.publicSlug!, versionId: version.id };
    });
    const key = `k-${unique()}`;
    const submit = () => getDb().transaction((tx) => staff.submitPublic(tx, { slug: setup.slug, versionId: setup.versionId, answers: complete, context: {}, requestKey: key }));
    const results = await Promise.all([submit(), submit()]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(results.filter((r) => "replayed" in r && r.replayed)).toHaveLength(1);
    const saved = await getDb().select().from(surveyResponse).where(eq(surveyResponse.shopId, setup.shopId));
    expect(saved).toHaveLength(1);
    const cases = await getDb().select().from(alertCase).where(eq(alertCase.responseId, saved[0].id));
    expect(cases).toHaveLength(1);
  });

  it("a public response keeps its shop, is saved unmatched and uncounted, then counts exactly once when matched (AT-13, AT-28)", () =>
    inRollback(async (tx) => {
      const { shop: s, version, visit } = await shopWithVisits(tx, ["M1,Jo,Smith,jo@example.com", "M2,Al,Lee,al@example.com"]);
      const key = `k-${unique()}`;
      const result = await staff.submitPublic(tx, { slug: s.publicSlug, versionId: version.id, answers: complete, context: { name: "Jo Smith", repairOrder: "M1", other: "ignored" }, requestKey: key });
      expect(result).toEqual({ ok: true, replayed: false });
      expect(await staff.submitPublic(tx, { slug: s.publicSlug, versionId: version.id, answers: complete, context: {}, requestKey: key })).toEqual({ ok: true, replayed: true });

      const [pub] = await tx.select().from(surveyResponse).where(and(eq(surveyResponse.shopId, s.id), eq(surveyResponse.source, "public")));
      expect(pub).toMatchObject({ matchStatus: "visit_unmatched", canonical: false, respondentContext: { name: "Jo Smith", repairOrder: "M1" } });

      const candidates = await staff.candidateVisits(tx, pub.id);
      expect(candidates[0]).toMatchObject({ sourceVisitKey: "M1" });
      expect(candidates[0].evidence.join(" ")).toMatch(/Visit ID M1/);
      expect(candidates[0].evidence.join(" ")).toMatch(/Last name Smith/);

      await staff.matchToVisit(tx, actor, pub.id, pub.matchRevision, visit("M1").id, "RO and last name match");
      expect(await countedFor(tx, visit("M1").id)).toHaveLength(1);
      await expect(staff.matchToVisit(tx, actor, pub.id, pub.matchRevision + 1, visit("M2").id, "again")).rejects.toMatchObject({ kind: "conflict" });
      const decisions = await tx.select().from(matchDecision).where(eq(matchDecision.responseId, pub.id));
      expect(decisions.map((d) => d.kind)).toEqual(["visit_matched"]);
      // Matching sends nothing: the visit still has only its original invitation email.
      const intents = await tx.select().from(emailIntent).innerJoin(invitation, eq(invitation.id, emailIntent.invitationId)).where(eq(invitation.visitId, visit("M1").id));
      expect(intents.every((i) => i.email_intent.kind === "initial")).toBe(true);
    }));

  it("a visit answered on paper leaves the invitation queue and gets no printable link (SR-24)", () =>
    inRollback(async (tx) => {
      // No email, so the visit is held with no invitation email yet.
      const { shop: s, visit } = await shopWithVisits(tx, ["P1,Pat,Doe,"]);
      const before = (await invitations.listQueue(tx, s.id)).find((r) => r.visitId === visit("P1").id)!;
      expect(before.view).toBe("held");
      await staff.submitPaper(tx, actor, { shopId: s.id, visitId: visit("P1").id, receivedOn: "2026-09-20", answers: complete, requestKey: `k-${unique()}` });
      const after = (await invitations.listQueue(tx, s.id)).find((r) => r.visitId === visit("P1").id)!;
      expect(after.view).toBe("excluded");
      expect(after.blockers).toContain("SURVEY_ANSWERED");
      await expect(invitations.issuePrintableLink(tx, actor, s.id, after.id)).rejects.toMatchObject({ kind: "invalid" });
    }));

  it("public lookups never reach another shop's visits (AT-01, AT-13)", () =>
    inRollback(async (tx) => {
      const a = await shopWithVisits(tx, ["X1,Jo,Smith,jo@example.com"]);
      const b = await shopWithVisits(tx, ["X1,Jo,Smith,jo@example.com"]);
      await staff.submitPublic(tx, { slug: a.shop.publicSlug, versionId: a.version.id, answers: complete, context: { repairOrder: "X1", name: "Jo Smith" }, requestKey: `k-${unique()}` });
      const [pub] = await tx.select().from(surveyResponse).where(and(eq(surveyResponse.shopId, a.shop.id), eq(surveyResponse.source, "public")));
      const candidates = await staff.candidateVisits(tx, pub.id);
      expect(candidates.map((c) => c.visitId)).toEqual([a.visit("X1").id]);
      await expect(staff.matchToVisit(tx, actor, pub.id, pub.matchRevision, b.visit("X1").id, "wrong shop")).rejects.toMatchObject({ kind: "invalid" });
      // A search term with LIKE wildcards is taken literally.
      expect(await staff.candidateVisits(tx, pub.id, "%")).toEqual(candidates);
    }));

  it("a shop suggestion stays PSG-only until confirmed, then visit matching is separate (AT-29)", () =>
    inRollback(async (tx) => {
      const { shop: s, version } = await shopWithVisits(tx, ["S1,Jo,Smith,jo@example.com"]);
      // An imported historical response without confirmed shop context.
      const [orphan] = await tx
        .insert(surveyResponse)
        .values({ instrumentVersionId: version.id, source: "paper", status: "submitted", isTest: false, submittedAt: new Date(), submitPayloadHash: "x", matchStatus: "shop_unconfirmed" })
        .returning();
      await tx.insert(shopSuggestion).values({ responseId: orphan.id, shopId: s.id, evidence: "Legacy company name 'Match Shop' (source id 1042)" });
      const full = await staff.getFullResponse(tx, orphan.id);
      expect(full?.suggestions).toEqual([{ shopId: s.id, shopName: "Match Shop", evidence: "Legacy company name 'Match Shop' (source id 1042)" }]);
      expect(full?.response.shopId).toBeNull();
      // The suggested shop sees nothing of it before confirmation: not on its dashboard, not by id.
      const window = { from: "2000-01-01", to: "2100-01-01", basis: "submitted", source: "all", version: "all" } as const;
      expect((await dashboard.cohortRows(tx, s.id, window, "America/Chicago")).some((r) => r.id === orphan.id)).toBe(false);
      expect(await dashboard.shopResponse(tx, s.id, orphan.id, false)).toBeNull();

      // Checked but still unmatched: recorded with a note, nothing else changes.
      await expect(staff.recordUnresolved(tx, actor, orphan.id, orphan.matchRevision, "no")).rejects.toMatchObject({ kind: "invalid" });
      await staff.recordUnresolved(tx, actor, orphan.id, orphan.matchRevision, "Searched legacy ids 1040-1045, no match");
      const checked = await responseRow(tx, orphan.id);
      expect(checked).toMatchObject({ shopId: null, matchStatus: "shop_unconfirmed", matchRevision: orphan.matchRevision + 1 });
      const [unresolved] = await tx.select().from(matchDecision).where(and(eq(matchDecision.responseId, orphan.id), eq(matchDecision.kind, "unresolved")));
      expect(unresolved.evidence).toBe("Searched legacy ids 1040-1045, no match");

      await staff.confirmShop(tx, actor, orphan.id, checked.matchRevision, s.id, "Company name and source id match");
      expect(await responseRow(tx, orphan.id)).toMatchObject({ shopId: s.id, matchStatus: "visit_unmatched", canonical: false });
    }));

  it("keeping the counted response settles a duplicate without changing what counts", () =>
    inRollback(async (tx) => {
      const { shop: s, visit } = await shopWithVisits(tx, ["K1,Jo,Smith,jo@example.com"]);
      const first = await staff.submitPaper(tx, actor, { shopId: s.id, visitId: visit("K1").id, receivedOn: "2026-09-20", answers: complete, requestKey: `k-${unique()}` });
      const second = await staff.submitPaper(tx, actor, { shopId: s.id, visitId: visit("K1").id, receivedOn: "2026-09-21", answers: happy, requestKey: `k-${unique()}` });
      const dup = await responseRow(tx, second.responseId);
      expect(dup.matchStatus).toBe("duplicate_review");
      await staff.resolveDuplicate(tx, actor, second.responseId, dup.matchRevision, "keep_original", "Second form is a photocopy of the first");
      expect((await countedFor(tx, visit("K1").id)).map((r) => r.id)).toEqual([first.responseId]);
      expect(await responseRow(tx, second.responseId)).toMatchObject({ canonical: false, matchStatus: "matched", duplicateDisposition: "kept_original" });
      await expect(staff.resolveDuplicate(tx, actor, second.responseId, dup.matchRevision, "promote", "Changed my mind")).rejects.toMatchObject({ kind: "conflict" });
    }));

  it("a legacy-surveyed visit keeps a matched response only as a reference", () =>
    inRollback(async (tx) => {
      const { shop: s, version, visit } = await shopWithVisits(tx, ["L1,Jo,Smith,jo@example.com"]);
      const ledger = await imports.createBatch(tx, actor, { shopId: s.id, kind: "legacy_ledger", isTest: false, sourceSystem: "shop_documents", fileName: "l.csv", content: "RO,Sent\nL1,9/1/2026" });
      await imports.commitBatch(tx, actor, ledger.id, ledger.revision);
      await staff.submitPublic(tx, { slug: s.publicSlug, versionId: version.id, answers: complete, context: { repairOrder: "L1" }, requestKey: `k-${unique()}` });
      const [pub] = await tx.select().from(surveyResponse).where(and(eq(surveyResponse.shopId, s.id), eq(surveyResponse.source, "public")));
      const placement = await staff.matchToVisit(tx, actor, pub.id, pub.matchRevision, visit("L1").id, "RO matches");
      expect(placement).toMatchObject({ canonical: false, duplicateDisposition: "legacy_reference" });
      expect(await countedFor(tx, visit("L1").id)).toHaveLength(0);
    }));

  it("a correction appends a revision with reason and flags a changed alert outcome (AT-20)", () =>
    inRollback(async (tx) => {
      const { shop: s, visit } = await shopWithVisits(tx, ["C1,Jo,Smith,jo@example.com"]);
      const paper = await staff.submitPaper(tx, actor, { shopId: s.id, visitId: visit("C1").id, receivedOn: "2026-09-20", answers: complete, requestKey: `k-${unique()}` });
      await expect(staff.correctResponse(tx, actor, paper.responseId, 1, happy, "")).rejects.toMatchObject({ kind: "invalid" });
      await expect(staff.correctResponse(tx, actor, paper.responseId, 1, complete, "Typo on the paper form")).rejects.toMatchObject({ message: "Nothing changed." });

      const result = await staff.correctResponse(tx, actor, paper.responseId, 1, happy, "Entered the wrong rating from the paper form");
      expect(result.revision).toBe(2);
      const full = await staff.getFullResponse(tx, paper.responseId);
      expect(full?.revisions.map((r) => r.revision)).toEqual([1, 2]);
      expect(full?.revisions[0].answers).toMatchObject({ overall_rating: 2 });
      expect(full?.revisions[1]).toMatchObject({ reason: "Entered the wrong rating from the paper form", answers: { overall_rating: 5 } });
      const alertsBefore = (full!.revisions[0].outcomes.alerts ?? []).length;
      const alertsAfter = (full!.revisions[1].outcomes.alerts ?? []).length;
      expect(result.alertsChanged).toBe(alertsBefore !== alertsAfter || JSON.stringify(full!.revisions[0].outcomes.alerts) !== JSON.stringify(full!.revisions[1].outcomes.alerts));
      // Stale editors are refused; revisions are append-only in the database.
      await expect(staff.correctResponse(tx, actor, paper.responseId, 1, complete, "Changed my mind")).rejects.toMatchObject({ kind: "conflict" });
      await expect(tx.transaction((inner) => inner.update(responseRevision).set({ reason: "x" }).where(eq(responseRevision.responseId, paper.responseId)))).rejects.toThrow();
    }));

  it("rejects paper entry with a future received date or invalid answers", () =>
    inRollback(async (tx) => {
      const { shop: s } = await shopWithVisits(tx, ["F1,Jo,Smith,jo@example.com"]);
      await expect(staff.submitPaper(tx, actor, { shopId: s.id, visitId: null, receivedOn: "2999-01-01", answers: complete, requestKey: `k-${unique()}` })).rejects.toMatchObject({ kind: "invalid" });
      await expect(staff.submitPaper(tx, actor, { shopId: s.id, visitId: null, receivedOn: "2026-09-20", answers: { overall_rating: 99 }, requestKey: `k-${unique()}` })).rejects.toMatchObject({ kind: "invalid" });
      const ok = await staff.submitPaper(tx, actor, { shopId: s.id, visitId: null, receivedOn: "2026-09-20", answers: complete, requestKey: `k-${unique()}` });
      expect(await responseRow(tx, ok.responseId)).toMatchObject({ matchStatus: "visit_unmatched", canonical: false });
    }));
});
