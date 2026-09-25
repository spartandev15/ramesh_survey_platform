/**
 * Database tests for respondent access, autosave and submission
 * (SR-12, SR-16, SR-17, SR-21). Every test rolls back.
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("respondent survey lifecycle", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { accessToken, auditEvent, responseRevision, shop, surveyResponse } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const store = await import("./store");
  const { hashToken } = await import("./tokens");
  type Tx = import("@/db/client").Tx;

  const actor = { type: "system" } as const;
  class Rollback extends Error {}
  const DAY = 24 * 60 * 60 * 1000;
  const unique = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  async function inRollback(body: (tx: Tx) => Promise<void>) {
    await expect(
      getDb().transaction(async (tx) => {
        await body(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  /** A shop, a published demo version and a test link issued at `now`. */
  async function setup(tx: Tx, now = new Date()) {
    const [s] = await tx.insert(shop).values({ name: "Test Shop", publicSlug: `test-${unique().replace("_", "-")}`, isTestShop: true }).returning();
    const { draft } = await instruments.insertInstrument(tx, actor, { key: `resp_${unique()}`, name: "Demo" }, demoDefinition);
    const version = await instruments.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });
    const link = await store.createTestInvitation(tx, actor, { shopId: s.id, instrumentVersionId: version.id, lifetimeDays: 90, now });
    return { shop: s, version, ...link };
  }

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

  it("stores only a hash of the token and gives each link its own token (SR-12, AT-12)", () =>
    inRollback(async (tx) => {
      const a = await setup(tx);
      const b = await store.createTestInvitation(tx, actor, { shopId: a.shop.id, instrumentVersionId: a.version.id, lifetimeDays: 90 });
      expect(a.token).not.toBe(b.token);
      const stored = await tx.select({ hash: accessToken.tokenHash }).from(accessToken).where(eq(accessToken.invitationId, a.invitationId));
      expect(stored[0].hash).toBe(hashToken(a.token));
      expect(stored[0].hash).not.toContain(a.token);

      const audit = await tx.select({ after: auditEvent.after }).from(auditEvent).where(eq(auditEvent.subjectId, a.invitationId));
      expect(JSON.stringify(audit)).not.toContain(a.token);
    }));

  it("reveals nothing for an unknown or altered token (AT-12)", () =>
    inRollback(async (tx) => {
      const { token } = await setup(tx);
      const altered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
      expect(await store.getTokenState(tx, altered)).toEqual({ state: "invalid" });
    }));

  it("refuses to issue a link for an unpublished draft (SR-15)", () =>
    inRollback(async (tx) => {
      const { shop: s } = await setup(tx);
      const { draft } = await instruments.insertInstrument(tx, actor, { key: `draft_${unique()}`, name: "Draft" }, demoDefinition);
      await expect(store.createTestInvitation(tx, actor, { shopId: s.id, instrumentVersionId: draft.id, lifetimeDays: 90 })).rejects.toBeInstanceOf(store.ResponseConflictError);
    }));

  it("autosaves drafts, resumes them and rejects a stale tab (SR-16, AT-16)", () =>
    inRollback(async (tx) => {
      const { token } = await setup(tx);
      const first = await store.saveDraft(tx, token, 0, { overall_rating: 4 });
      expect(first).toMatchObject({ ok: true, revision: 1 });
      const second = await store.saveDraft(tx, token, 1, { overall_rating: 5, ready_on_time: "yes" });
      expect(second).toMatchObject({ ok: true, revision: 2 });

      // An older tab still on revision 1 cannot overwrite the newer answers.
      expect(await store.saveDraft(tx, token, 1, { overall_rating: 1 })).toEqual({ ok: false, reason: "stale" });

      const state = await store.getTokenState(tx, token);
      expect(state).toMatchObject({ state: "open", revision: 2, answers: { overall_rating: 5, ready_on_time: "yes" } });
    }));

  it("rejects invalid draft answers instead of storing them", () =>
    inRollback(async (tx) => {
      const { token } = await setup(tx);
      const result = await store.saveDraft(tx, token, 0, { overall_rating: 99, sneaky_score: 100 });
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
    }));

  it("submits once with server-computed outcomes and locks the answers (SR-17, AT-17)", () =>
    inRollback(async (tx) => {
      const { token } = await setup(tx);
      const result = await store.submitResponse(tx, token, "key-00000001", complete);
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.outcomes.alerts.map((a) => a.id)).toEqual(["low_overall", "not_on_time"]);
      expect(result.replayed).toBe(false);

      // Double click / network retry: same key, same answers → the original result.
      const retry = await store.submitResponse(tx, token, "key-00000001", complete);
      expect(retry).toMatchObject({ ok: true, responseId: result.responseId, replayed: true });
      // A fresh key with identical answers is also idempotent.
      expect(await store.submitResponse(tx, token, "key-00000002", complete)).toMatchObject({ ok: true, replayed: true });
      // Changed answers can never overwrite the submission, even under the original key.
      expect(await store.submitResponse(tx, token, "key-00000001", { ...complete, overall_rating: 5 })).toEqual({ ok: false, reason: "already_submitted" });

      expect(await store.saveDraft(tx, token, 99, { overall_rating: 5 })).toEqual({ ok: false, reason: "submitted" });
      expect(await store.getTokenState(tx, token)).toMatchObject({ state: "submitted" });

      const revisions = await tx.select().from(responseRevision).where(eq(responseRevision.responseId, result.responseId));
      expect(revisions).toHaveLength(1);
      expect(revisions[0].answers).not.toHaveProperty("sneaky");
    }));

  it("enforces the lock in the database, not just in code", () =>
    inRollback(async (tx) => {
      const { token } = await setup(tx);
      const result = await store.submitResponse(tx, token, "key-00000003", complete);
      if (!result.ok) throw new Error("submit failed");
      await expect(tx.transaction((sp) => sp.update(surveyResponse).set({ draftAnswers: {} }).where(eq(surveyResponse.id, result.responseId)))).rejects.toThrow();
      await expect(tx.transaction((sp) => sp.delete(surveyResponse).where(eq(surveyResponse.id, result.responseId)))).rejects.toThrow();
      await expect(tx.transaction((sp) => sp.update(responseRevision).set({ reason: "edit" }).where(eq(responseRevision.responseId, result.responseId)))).rejects.toThrow();
    }));

  it("does not submit with missing required answers", () =>
    inRollback(async (tx) => {
      const { token } = await setup(tx);
      const result = await store.submitResponse(tx, token, "key-00000004", { overall_rating: 3 });
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      expect(await store.getTokenState(tx, token)).toMatchObject({ state: "open" });
    }));

  it("blocks unanswered content after expiry but keeps a submitted survey locked (SR-21, AT-21)", () =>
    inRollback(async (tx) => {
      const issued = new Date(Date.now() - 100 * DAY);
      const expired = await setup(tx, issued);
      await store.saveDraft(tx, expired.token, 0, { overall_rating: 4 }, new Date(issued.getTime() + DAY));

      expect(await store.getTokenState(tx, expired.token)).toMatchObject({ state: "expired" });
      expect(await store.saveDraft(tx, expired.token, 1, { overall_rating: 5 })).toEqual({ ok: false, reason: "expired" });
      expect(await store.submitResponse(tx, expired.token, "key-00000005", complete)).toEqual({ ok: false, reason: "expired" });

      const done = await setup(tx, issued);
      await store.submitResponse(tx, done.token, "key-00000006", complete, new Date(issued.getTime() + DAY));
      expect(await store.getTokenState(tx, done.token)).toMatchObject({ state: "submitted" });
    }));

  it("marks test responses permanently as test data (AT-03)", () =>
    inRollback(async (tx) => {
      const { token } = await setup(tx);
      const result = await store.submitResponse(tx, token, "key-00000007", complete);
      if (!result.ok) throw new Error("submit failed");
      const [row] = await tx.select({ isTest: surveyResponse.isTest }).from(surveyResponse).where(eq(surveyResponse.id, result.responseId));
      expect(row.isTest).toBe(true);
      await expect(tx.transaction((sp) => sp.update(surveyResponse).set({ isTest: false }).where(eq(surveyResponse.id, result.responseId)))).rejects.toThrow();
    }));
});
