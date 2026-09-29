/**
 * Database tests for the email ledger (SR-22..SR-26; AT-03, AT-22..AT-26).
 * A fake provider counts every request, so "sent once" is proven by provider
 * calls as well as by rows (PDF 07 suite 3). Tests roll back, except the
 * two-worker test, which commits test-only data in an internal test shop.
 */
import { and, count, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("email ledger", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { accessToken, emailIntent, invitation, shop, shopOptOut, shopSurveySettings, testRecipientAllowlist } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const imports = await import("@/modules/imports/store");
  const responses = await import("@/modules/responses/store");
  const { EmailAcceptanceUnknownError, EmailRejectedError } = await import("@/modules/email/transport");
  const ledger = await import("./store");
  const { runDispatchCycle } = await import("./dispatcher");
  type Tx = import("@/db/client").Tx;
  type OutboundEmail = import("@/modules/email/transport").OutboundEmail;

  const actor = { type: "system" } as const;
  const links = { appUrl: "https://survey.test", optOutSecret: "test-secret" };
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = new Date("2026-10-05T15:00:00Z");
  const at = (days: number, minutes = 0) => new Date(T0.getTime() + days * DAY + minutes * 60 * 1000);
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

  /** Counts every provider request; can be told to fail. */
  class FakeProvider {
    readonly name = "fake";
    sent: OutboundEmail[] = [];
    behaviour: "accept" | "reject" | "unknown" = "accept";
    async send(message: OutboundEmail) {
      this.sent.push(message);
      if (this.behaviour === "reject") throw new EmailRejectedError("rejected", 400);
      if (this.behaviour === "unknown") throw new EmailAcceptanceUnknownError("timeout");
      return { providerMessageId: `fake-${this.sent.length}-${unique()}` };
    }
  }

  const tokenIn = (m: OutboundEmail) => /\/survey\/([A-Za-z0-9_-]{43})/.exec(m.text)![1];

  /** The dispatcher's three steps, inside the test transaction and limited to the given intents. */
  async function dispatch(tx: Tx, provider: FakeProvider, now: Date, intentIds: string[]) {
    const out = { sent: 0, stopped: [] as string[] };
    for (;;) {
      const p = await ledger.prepareNext(tx, "worker-1", links, now, { intentIds });
      if (p.kind === "none") return out;
      if (p.kind === "stopped") {
        out.stopped.push(`${p.state}:${p.reason}`);
        continue;
      }
      let outcome: import("./store").ProviderOutcome;
      try {
        const r = await provider.send(p.message);
        outcome = { result: "accepted", providerMessageId: r.providerMessageId };
      } catch (e) {
        outcome = e instanceof EmailRejectedError ? { result: "rejected", error: "rejected" } : { result: "unknown", error: "timeout" };
      }
      await ledger.recordOutcome(tx, p.intentId, p.tokenId, "worker-1", outcome, now);
      if (outcome.result === "accepted") out.sent++;
    }
  }

  async function publish(tx: Tx, isTest: boolean) {
    const { draft } = await instruments.insertInstrument(tx, actor, { key: `mail_${unique()}`, name: "Demo" }, demoDefinition);
    return instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest, sourceNote: isTest ? null : "Approved export, checksum abc" });
  }

  /** A Live production shop (verified version, cutoff, legacy confirmed) with one imported eligible visit. */
  async function liveShopWithInvitation(tx: Tx, email = "jo@example.com") {
    const [s] = await tx.insert(shop).values({ name: "Mail Shop", publicSlug: `mail-${unique().replace("_", "-")}`, timezone: "America/Chicago" }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    const version = await publish(tx, false);
    const saved = await settings.updateSettings(
      tx,
      actor,
      s.id,
      1,
      settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-10-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: [], logoUrl: "", brandColor: "" }),
    );
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: T0 }).where(eq(shopSurveySettings.shopId, s.id));
    const live = await settings.changeMode(tx, actor, s.id, saved.revision, "live", at(-1));
    const batch = await imports.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "m.csv", content: `RO,First Name,Email,Delivered On\n1001,Jo,${email},2026-10-02` });
    await imports.commitBatch(tx, actor, batch.id, batch.revision, T0);
    const [inv] = await tx.select().from(invitation).where(eq(invitation.shopId, s.id));
    const [intent] = await tx.select().from(emailIntent).where(eq(emailIntent.invitationId, inv.id));
    // Queued now; dispatch uses the test clock.
    await tx.update(emailIntent).set({ dueAt: T0 }).where(eq(emailIntent.id, intent.id));
    return { shop: s, invitation: inv, intent, revision: live.revision };
  }

  const intentsOf = (tx: Tx, invitationId: string) => tx.select().from(emailIntent).where(eq(emailIntent.invitationId, invitationId));

  const complete = {
    overall_rating: 2,
    ready_on_time: "no",
    delay_detail: "Two days late",
    service_aspects: { communication: "fair", quality: "good", cleanliness: "good" },
    recommend_score: 6,
  };

  afterAll(async () => {
    await getPool().end();
  });

  it("sends the initial invitation once, branded, and never again (AT-23)", () =>
    inRollback(async (tx) => {
      const { intent, invitation: inv } = await liveShopWithInvitation(tx);
      const provider = new FakeProvider();
      expect((await dispatch(tx, provider, T0, [intent.id])).sent).toBe(1);
      expect((await dispatch(tx, provider, at(0, 5), [intent.id])).sent).toBe(0);
      expect(provider.sent).toHaveLength(1);
      const [message] = provider.sent;
      expect(message).toMatchObject({ to: "jo@example.com", correlationId: intent.id });
      expect(message.subject).toContain("Mail Shop");
      expect(message.text).toContain("https://survey.test/survey/opt-out/");
      const [row] = await intentsOf(tx, inv.id);
      expect(row).toMatchObject({ state: "accepted", attempts: 1 });
      // The emailed link opens the survey.
      expect((await responses.getTokenState(tx, tokenIn(message), T0)).state).toBe("open");
    }));

  it("an ambiguous timeout is reconciled from provider evidence, never resent (AT-23)", () =>
    inRollback(async (tx) => {
      const { intent } = await liveShopWithInvitation(tx);
      const provider = new FakeProvider();
      provider.behaviour = "unknown";
      await dispatch(tx, provider, T0, [intent.id]);
      provider.behaviour = "accept";
      expect((await dispatch(tx, provider, at(1), [intent.id])).sent).toBe(0);
      expect(provider.sent).toHaveLength(1);

      const event = { providerEventId: `ev-${unique()}`, eventType: "delivered", occurredAt: at(0, 1), intentId: intent.id, providerMessageId: null, detail: {} };
      expect(await ledger.applyProviderEvents(tx, "sendgrid", [event])).toEqual({ applied: 1, duplicates: 0 });
      expect(await ledger.applyProviderEvents(tx, "sendgrid", [event])).toEqual({ applied: 0, duplicates: 1 });
      const [row] = await tx.select().from(emailIntent).where(eq(emailIntent.id, intent.id));
      expect(row).toMatchObject({ state: "delivered", acceptedAt: at(0, 1) });
      // A late "processed" event does not move it backwards.
      await ledger.applyProviderEvents(tx, "sendgrid", [{ ...event, providerEventId: `ev-${unique()}`, eventType: "processed" }]);
      expect((await tx.select().from(emailIntent).where(eq(emailIntent.id, intent.id)))[0].state).toBe("delivered");
    }));

  it("a worker that dies mid-send leaves the outcome unknown, not a second email (AT-23)", () =>
    inRollback(async (tx) => {
      const { intent } = await liveShopWithInvitation(tx);
      const claimed = await ledger.prepareNext(tx, "crashed-worker", links, T0, { intentIds: [intent.id] });
      expect(claimed.kind).toBe("send");
      expect(await ledger.reclaimExpiredLeases(tx, at(0, 1))).toBe(0);
      expect(await ledger.reclaimExpiredLeases(tx, at(0, 10))).toBeGreaterThanOrEqual(1);
      const provider = new FakeProvider();
      expect((await dispatch(tx, provider, at(0, 11), [intent.id])).sent).toBe(0);
      expect((await tx.select().from(emailIntent).where(eq(emailIntent.id, intent.id)))[0].state).toBe("acceptance_unknown");

      // PSG checks the provider and records the evidence.
      await expect(ledger.resolveProblem(tx, actor, intent.id, "confirm_sent", "", at(1))).rejects.toMatchObject({ kind: "invalid" });
      await ledger.resolveProblem(tx, actor, intent.id, "confirm_sent", "SendGrid activity shows delivered", at(1));
      expect((await tx.select().from(emailIntent).where(eq(emailIntent.id, intent.id)))[0].state).toBe("accepted");
    }));

  it("retries a definite rejection with backoff, revokes unsent links, then fails", () =>
    inRollback(async (tx) => {
      const { intent, invitation: inv } = await liveShopWithInvitation(tx);
      const provider = new FakeProvider();
      provider.behaviour = "reject";
      await dispatch(tx, provider, T0, [intent.id]);
      await dispatch(tx, provider, at(0, 1), [intent.id]);
      expect(provider.sent).toHaveLength(1);
      await dispatch(tx, provider, at(0, 6), [intent.id]);
      await dispatch(tx, provider, at(0, 20), [intent.id]);
      expect(provider.sent).toHaveLength(3);
      expect((await tx.select().from(emailIntent).where(eq(emailIntent.id, intent.id)))[0].state).toBe("failed");
      const [{ n }] = await tx.select({ n: count() }).from(accessToken).where(and(eq(accessToken.invitationId, inv.id), isNull(accessToken.revokedAt)));
      expect(n).toBe(0);
    }));

  it("schedules exactly one reminder after the delay and sends it once, with the same deadline (AT-24)", () =>
    inRollback(async (tx) => {
      const { intent, invitation: inv } = await liveShopWithInvitation(tx);
      const provider = new FakeProvider();
      await dispatch(tx, provider, T0, [intent.id]);
      const remindersOf = async () => (await intentsOf(tx, inv.id)).filter((i) => i.kind === "reminder");
      // Counts are per invitation: the scheduler also sees other test data in the database.
      await ledger.scheduleReminders(tx, at(6));
      expect(await remindersOf()).toHaveLength(0);
      await ledger.scheduleReminders(tx, at(7));
      await ledger.scheduleReminders(tx, at(8));
      const reminders = (await intentsOf(tx, inv.id)).filter((i) => i.kind === "reminder");
      expect(reminders).toHaveLength(1);
      expect(reminders[0].state).toBe("queued");

      await dispatch(tx, provider, at(8), [reminders[0].id]);
      await dispatch(tx, provider, at(9), [reminders[0].id]);
      expect(provider.sent).toHaveLength(2);
      expect(provider.sent[1].subject).toContain("reminder");
      const tokens = await tx.select().from(accessToken).where(eq(accessToken.invitationId, inv.id));
      expect(new Set(tokens.map((t) => t.expiresAt.getTime())).size).toBe(1);
      // A reimport never adds another reminder.
      await ledger.scheduleReminders(tx, at(30));
      expect((await intentsOf(tx, inv.id)).filter((i) => i.kind === "reminder")).toHaveLength(1);
    }));

  it("a submission before dispatch cancels the reminder (AT-24)", () =>
    inRollback(async (tx) => {
      const { intent, invitation: inv } = await liveShopWithInvitation(tx);
      const provider = new FakeProvider();
      await dispatch(tx, provider, T0, [intent.id]);
      await ledger.scheduleReminders(tx, at(7));
      const result = await responses.submitResponse(tx, tokenIn(provider.sent[0]), "request-key-1", complete, at(7, 1));
      expect(result.ok).toBe(true);
      const reminder = (await intentsOf(tx, inv.id)).find((i) => i.kind === "reminder")!;
      expect(reminder).toMatchObject({ state: "cancelled", stateReason: "SUBMITTED" });
      expect((await dispatch(tx, provider, at(8), [reminder.id])).sent).toBe(0);
      expect(provider.sent).toHaveLength(1);
    }));

  it("an opt-out before dispatch stops sends at that shop only (AT-24, AT-25)", () =>
    inRollback(async (tx) => {
      const a = await liveShopWithInvitation(tx);
      const b = await liveShopWithInvitation(tx);
      await ledger.recordOptOut(tx, { type: "respondent" }, a.invitation.id, "respondent_link", T0);
      const provider = new FakeProvider();
      expect((await dispatch(tx, provider, T0, [a.intent.id, b.intent.id])).sent).toBe(1);
      expect(provider.sent[0].correlationId).toBe(b.intent.id);
      expect((await tx.select().from(emailIntent).where(eq(emailIntent.id, a.intent.id)))[0]).toMatchObject({ state: "cancelled", stateReason: "SHOP_OPT_OUT" });
      // Idempotent, and a later opt-out recorded elsewhere is still caught at dispatch.
      await ledger.recordOptOut(tx, { type: "respondent" }, a.invitation.id, "respondent_link", T0);
      expect((await tx.select({ n: count() }).from(shopOptOut).where(eq(shopOptOut.shopId, a.shop.id)))[0].n).toBe(1);
    }));

  it("an archived shop sends nothing more, whatever was already queued", () =>
    inRollback(async (tx) => {
      const { shop: s, intent } = await liveShopWithInvitation(tx);
      await tx.update(shop).set({ archivedAt: T0 }).where(eq(shop.id, s.id));
      const provider = new FakeProvider();
      expect(await dispatch(tx, provider, T0, [intent.id])).toEqual({ sent: 0, stopped: ["cancelled:SHOP_ARCHIVED"] });
      expect(provider.sent).toHaveLength(0);
    }));

  it("a shop paused before dispatch sends nothing; existing surveys still submit; resume does not bulk-send (AT-26)", () =>
    inRollback(async (tx) => {
      const { shop: s, intent, invitation: inv, revision } = await liveShopWithInvitation(tx);
      const link = await (await import("@/modules/invitations/store")).issuePrintableLink(tx, actor, s.id, inv.id, T0);
      const paused = await settings.changeMode(tx, actor, s.id, revision, "paused", at(0, 1));
      const provider = new FakeProvider();
      expect(await dispatch(tx, provider, at(0, 2), [intent.id])).toEqual({ sent: 0, stopped: ["held:SHOP_PAUSED"] });
      expect((await responses.submitResponse(tx, link.token, "request-key-2", complete, at(0, 3))).ok).toBe(true);

      await settings.changeMode(tx, actor, s.id, paused.revision, "live", at(1));
      expect((await dispatch(tx, provider, at(1, 1), [intent.id])).sent).toBe(0);
      await ledger.resolveProblem(tx, actor, intent.id, "release", "", at(1, 2));
      // Released, but the survey was already submitted, so it is cancelled at dispatch.
      expect(await dispatch(tx, provider, at(1, 3), [intent.id])).toEqual({ sent: 0, stopped: ["cancelled:SUBMITTED"] });
      expect(provider.sent).toHaveLength(0);
    }));

  it("a reminder that fell due during a pause waits for PSG review (P-04)", () =>
    inRollback(async (tx) => {
      const { shop: s, intent, invitation: inv, revision } = await liveShopWithInvitation(tx);
      await dispatch(tx, new FakeProvider(), T0, [intent.id]);
      const paused = await settings.changeMode(tx, actor, s.id, revision, "paused", at(1));
      await ledger.scheduleReminders(tx, at(8));
      expect((await intentsOf(tx, inv.id)).filter((i) => i.kind === "reminder")).toHaveLength(0);
      await settings.changeMode(tx, actor, s.id, paused.revision, "live", at(10));
      await ledger.scheduleReminders(tx, at(10, 5));
      const reminder = (await intentsOf(tx, inv.id)).find((i) => i.kind === "reminder")!;
      expect(reminder).toMatchObject({ state: "held", stateReason: "OVERDUE_AFTER_PAUSE" });
    }));

  it("renews an expired survey to the address on record, keeps answers, replaces old links, adds no reminder (AT-22)", () =>
    inRollback(async (tx) => {
      const { intent, invitation: inv } = await liveShopWithInvitation(tx);
      const provider = new FakeProvider();
      await dispatch(tx, provider, T0, [intent.id]);
      const oldToken = tokenIn(provider.sent[0]);
      const saved = await responses.saveDraft(tx, oldToken, 0, { overall_rating: 4 }, at(1));
      expect(saved.ok).toBe(true);

      expect((await responses.getTokenState(tx, oldToken, at(91))).state).toBe("expired");
      await ledger.requestRenewal(tx, oldToken, at(91));
      await ledger.requestRenewal(tx, oldToken, at(91, 1));
      const renewals = (await intentsOf(tx, inv.id)).filter((i) => i.kind === "renewal");
      expect(renewals).toHaveLength(1);
      expect(renewals[0].recipient).toBe("jo@example.com");

      await dispatch(tx, provider, at(91, 2), [renewals[0].id]);
      expect(provider.sent).toHaveLength(2);
      const newToken = tokenIn(provider.sent[1]);
      expect((await responses.getTokenState(tx, oldToken, at(91, 3))).state).toBe("invalid");
      const reopened = await responses.getTokenState(tx, newToken, at(91, 3));
      expect(reopened).toMatchObject({ state: "open", answers: { overall_rating: 4 } });
      expect((await intentsOf(tx, inv.id)).filter((i) => i.kind === "reminder")).toHaveLength(0);
      // An open (not expired) link cannot request renewal.
      await ledger.requestRenewal(tx, newToken, at(92));
      expect((await intentsOf(tx, inv.id)).filter((i) => i.kind === "renewal")).toHaveLength(1);
    }));

  it("refuses a test email to an address removed from the allowlist, at send time (AT-03)", () =>
    inRollback(async (tx) => {
      const domain = `@qa-${unique().replace("_", "-")}.example`;
      const [entry] = await tx.insert(testRecipientAllowlist).values({ entry: domain }).returning();
      const [s] = await tx.insert(shop).values({ name: "QA", publicSlug: `qa-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      await settings.insertDefaultSettings(tx, s.id);
      const version = await publish(tx, true);
      await tx.update(shopSurveySettings).set({ instrumentVersionId: version.id }).where(eq(shopSurveySettings.shopId, s.id));
      const batch = await imports.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: true, sourceSystem: "shop_documents", fileName: "t.csv", content: `RO,Email,Delivered On\n1,qa${domain},2026-10-02` });
      await imports.commitBatch(tx, actor, batch.id, batch.revision, T0);
      const [inv] = await tx.select().from(invitation).where(eq(invitation.shopId, s.id));
      const [intent] = await intentsOf(tx, inv.id);
      await tx.update(emailIntent).set({ dueAt: T0 }).where(eq(emailIntent.id, intent.id));

      await tx.delete(testRecipientAllowlist).where(eq(testRecipientAllowlist.id, entry.id));
      const provider = new FakeProvider();
      expect(await dispatch(tx, provider, T0, [intent.id])).toEqual({ sent: 0, stopped: ["cancelled:TEST_RECIPIENT_NOT_ALLOWED"] });
      expect(provider.sent).toHaveLength(0);
    }));

  it("two workers dispatching at once send each email exactly once (AT-23)", async () => {
    const domain = `@conc-${unique().replace("_", "-")}.example`;
    const ids = await getDb().transaction(async (tx) => {
      await tx.insert(testRecipientAllowlist).values({ entry: domain, note: "email ledger concurrency test" });
      const [s] = await tx.insert(shop).values({ name: "E2E Mail Concurrency (internal test)", publicSlug: `mconc-${unique().replace("_", "-")}`, isTestShop: true }).returning();
      await settings.insertDefaultSettings(tx, s.id);
      const version = await publish(tx, true);
      await tx.update(shopSurveySettings).set({ instrumentVersionId: version.id }).where(eq(shopSurveySettings.shopId, s.id));
      const rows = Array.from({ length: 8 }, (_, i) => `${i + 1},qa${i}${domain},2026-10-02`).join("\n");
      const batch = await imports.createBatch(tx, actor, { shopId: s.id, kind: "visits", isTest: true, sourceSystem: "shop_documents", fileName: "c.csv", content: `RO,Email,Delivered On\n${rows}` });
      await imports.commitBatch(tx, actor, batch.id, batch.revision);
      const intents = await tx.select({ id: emailIntent.id }).from(emailIntent).innerJoin(invitation, eq(invitation.id, emailIntent.invitationId)).where(eq(invitation.shopId, s.id));
      return intents.map((i) => i.id);
    });
    expect(ids).toHaveLength(8);
    const [p1, p2] = [new FakeProvider(), new FakeProvider()];
    await Promise.all([runDispatchCycle(p1, "worker-a", { links, scope: { intentIds: ids } }), runDispatchCycle(p2, "worker-b", { links, scope: { intentIds: ids } })]);
    const correlations = [...p1.sent, ...p2.sent].map((m) => m.correlationId);
    expect(correlations).toHaveLength(8);
    expect(new Set(correlations).size).toBe(8);
  });
});
