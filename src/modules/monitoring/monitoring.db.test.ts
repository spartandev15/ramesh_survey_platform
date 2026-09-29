/**
 * Operations notices against the real database (PDF 09): a notice is sent
 * once per problem, repeated only hourly, cleared once; the daily report goes
 * out once per day however many workers run; the counts are production only.
 * Everything rolls back.
 */
import { and, count, eq, lte } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("operations notices", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { emailIntent, opsNotice } = await import("@/db/schema");
  const { notifyProblems, sendDailyReport } = await import("./monitoring");
  const store = await import("./store");
  type Tx = import("@/db/client").Tx;
  type OutboundEmail = import("@/modules/email/transport").OutboundEmail;

  class Rollback extends Error {}
  async function inRollback(body: (tx: Tx) => Promise<void>) {
    await expect(
      getDb().transaction(async (tx) => {
        await body(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  function fakeNotify(recipients = ["ops@psg.test", "backup@psg.test"]) {
    const sent: OutboundEmail[] = [];
    return { sent, notify: { recipients, appUrl: "https://hub.test", transport: { name: "fake", send: async (m: OutboundEmail) => (sent.push(m), { providerMessageId: null }) } } };
  }

  const T0 = new Date("2026-10-05T15:00:00Z");
  const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
  const stuck = { queuedDue: 2, oldestQueuedDue: new Date(T0.getTime() - 20 * 60_000), recentEmailErrors: 0, bridgeProblems: 0 };
  const calm = { queuedDue: 0, oldestQueuedDue: null, recentEmailErrors: 0, bridgeProblems: 0 };

  afterAll(async () => {
    await getPool().end();
  });

  it("emails every recipient when a problem starts, then only hourly, then once when it clears", () =>
    inRollback(async (tx) => {
      await tx.delete(opsNotice);
      const { sent, notify } = fakeNotify();

      expect(await notifyProblems(tx, stuck, notify, T0)).toEqual(["email_dispatch_stuck:send"]);
      expect(sent.map((m) => m.to)).toEqual(["ops@psg.test", "backup@psg.test"]);
      expect(sent[0].subject).toBe("[PSG Hub] Action needed: Survey emails are not being sent");

      // Checks every 5 minutes send nothing new within the hour.
      for (const m of [5, 10, 55]) expect(await notifyProblems(tx, stuck, notify, later(m))).toEqual([]);
      expect(await notifyProblems(tx, stuck, notify, later(60))).toEqual(["email_dispatch_stuck:repeat"]);
      expect(await notifyProblems(tx, calm, notify, later(65))).toEqual(["email_dispatch_stuck:recover"]);
      expect(await notifyProblems(tx, calm, notify, later(70))).toEqual([]);
      expect(sent).toHaveLength(6);
      expect(sent[5].subject).toContain("Resolved");

      // It starts again later: a new first notice with a new start time.
      expect(await notifyProblems(tx, stuck, notify, later(120))).toEqual(["email_dispatch_stuck:send"]);
      const [row] = await tx.select().from(opsNotice).where(eq(opsNotice.key, "email_dispatch_stuck"));
      expect(row).toMatchObject({ open: true, firstSeenAt: later(120), lastSentAt: later(120) });
    }));

  it("records a notice as delivered to the log when no operations address is set", () =>
    inRollback(async (tx) => {
      await tx.delete(opsNotice);
      const { sent, notify } = fakeNotify([]);
      expect(await notifyProblems(tx, stuck, notify, T0)).toEqual(["email_dispatch_stuck:send"]);
      expect(sent).toHaveLength(0);
      expect(await notifyProblems(tx, stuck, notify, later(5))).toEqual([]);
    }));

  it("sends the daily report once per day, however often the job runs", () =>
    inRollback(async (tx) => {
      await tx.delete(opsNotice);
      const { sent, notify } = fakeNotify(["ops@psg.test"]);
      expect(await sendDailyReport(tx, notify, T0)).toBe(true);
      expect(await sendDailyReport(tx, notify, later(60))).toBe(false);
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toMatch(/^\[PSG Hub\] Daily counts for Oct 5, 2026/);
      // The next day is a new report.
      expect(await sendDailyReport(tx, notify, later(24 * 60))).toBe(true);
      expect(sent).toHaveLength(2);
    }));

  it("counts production emails only", () =>
    inRollback(async (tx) => {
      const facts = await store.healthFacts(tx, T0);
      const [direct] = await tx
        .select({ n: count() })
        .from(emailIntent)
        .where(and(eq(emailIntent.isTest, false), eq(emailIntent.state, "queued"), lte(emailIntent.dueAt, T0)));
      expect(facts.queuedDue).toBe(direct.n);
      // Test sends queued in the dev database never raise a production notice.
      await tx.update(emailIntent).set({ dueAt: new Date(T0.getTime() - 60 * 60_000) }).where(and(eq(emailIntent.isTest, true), eq(emailIntent.state, "queued")));
      expect((await store.healthFacts(tx, T0)).queuedDue).toBe(direct.n);

      const daily = await store.dailyCounts(tx, T0);
      expect(daily.emailsQueuedDue).toBe(direct.n);
      expect(Object.values(daily.responsesSubmitted).every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
    }));
});
