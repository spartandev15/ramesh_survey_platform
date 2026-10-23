/**
 * Database tests for the operator queues (SR-38, AT-38). Every test rolls back.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("operator queues", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { auditEvent, emailIntent, invitation, psgStaffRole, repairVisit, shop, shopSurveySettings, suppressionAction, user } = await import("@/db/schema");
  const instruments = await import("@/modules/instruments/store");
  const { demoDefinition } = await import("@/modules/instruments/demo-definition");
  const settings = await import("@/modules/shops/settings-store");
  const { settingsInputSchema } = await import("@/modules/shops/settings-policy");
  const imports = await import("@/modules/imports/store");
  const invitations = await import("@/modules/invitations/store");
  const staff = await import("@/modules/responses/staff-store");
  const ledger = await import("@/modules/email-ledger/store");
  const ops = await import("./store");
  type Tx = import("@/db/client").Tx;

  const system = { type: "system" } as const;
  const links = { appUrl: "https://survey.test", optOutSecret: "test-secret" };
  class Rollback extends Error {}
  const unique = () => `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const hours = (n: number) => n * 60 * 60 * 1000;

  async function inRollback(body: (tx: Tx) => Promise<void>) {
    await expect(
      getDb().transaction(async (tx) => {
        await body(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  async function staffUser(tx: Tx, role: "psg_operator" | null = "psg_operator") {
    const id = `ops-${unique()}`;
    await tx.insert(user).values({ id, name: `Operator ${id}`, email: `${id}@psg.test` });
    if (role) await tx.insert(psgStaffRole).values({ userId: id, role });
    return { type: "user" as const, userId: id };
  }

  /** A Live production shop with confirmed legacy coverage and the given CSV rows (RO,Last Name,Email,Delivered On). */
  async function liveShop(tx: Tx, rows: string[]) {
    const [s] = await tx.insert(shop).values({ name: `Ops Shop ${unique()}`, publicSlug: `ops-${unique().replace("_", "-")}` }).returning();
    await settings.insertDefaultSettings(tx, s.id);
    const { draft } = await instruments.insertInstrument(tx, system, { key: `ops_${unique()}`, name: "Demo" }, demoDefinition);
    const version = await instruments.publishVersion(tx, system, draft.id, draft.revision, { isTest: false, sourceNote: "Approved export, checksum abc" });
    const saved = await settings.updateSettings(
      tx,
      system,
      s.id,
      1,
      settingsInputSchema.parse({ instrumentVersionId: version.id, deliveryCutoff: "2026-01-01", timezone: "America/Chicago", reminderDelayDays: 7, linkLifetimeDays: 90, alertRecipients: [], logoUrl: "", brandColor: "" }),
    );
    await tx.update(shopSurveySettings).set({ legacyCoverageConfirmedAt: new Date() }).where(eq(shopSurveySettings.shopId, s.id));
    await settings.changeMode(tx, system, s.id, saved.revision, "live");
    if (rows.length > 0) {
      const batch = await imports.createBatch(tx, system, { shopId: s.id, kind: "visits", isTest: false, sourceSystem: "shop_documents", fileName: "ops.csv", content: ["RO,Last Name,Email,Delivered On", ...rows].join("\n") });
      await imports.commitBatch(tx, system, batch.id, batch.revision);
    }
    return s;
  }

  const invitationFor = async (tx: Tx, shopId: string, key: string) =>
    (await tx.select({ id: invitation.id, revision: invitation.revision }).from(invitation).innerJoin(repairVisit, eq(repairVisit.id, invitation.visitId)).where(and(eq(repairVisit.shopId, shopId), eq(repairVisit.sourceVisitKey, key))))[0];

  /** Queue the initial email for one visit and return its intent id. */
  async function queueInitial(tx: Tx, shopId: string, key: string) {
    const inv = await invitationFor(tx, shopId, key);
    // A committed Live import may already have queued it; explicit send covers the rest.
    await invitations.sendInvitations(tx, system, shopId, [inv]);
    const [intent] = await tx.select({ id: emailIntent.id }).from(emailIntent).where(and(eq(emailIntent.invitationId, inv.id), eq(emailIntent.kind, "initial")));
    return intent.id;
  }

  const itemFor = async (tx: Tx, subjectId: string, now = new Date()) => (await ops.listOperatorItems(tx, now)).find((i) => i.subjectId === subjectId);

  afterAll(async () => {
    await getPool().end();
  });

  it("lists a held import with its reason and the file row it came from", () =>
    inRollback(async (tx) => {
      const s = await liveShop(tx, ["H1,Smith,,"]);
      const inv = await invitationFor(tx, s.id, "H1");
      // Production work shows whether or not test data is included.
      expect((await ops.listOperatorItems(tx, new Date(), { includeTest: false })).some((i) => i.subjectId === inv.id)).toBe(true);
      const item = await itemFor(tx, inv.id);
      expect(item).toMatchObject({ kind: "held_import", subjectType: "invitation", shopId: s.id, isTest: false, owner: null, revision: 0, href: `/psg/invitations?shop=${s.id}&view=held` });
      expect(item?.reason).toContain("Delivery date needed");
      expect(item?.provenance).toBe("Imported from ops.csv, row 1");
    }));

  it("a file row that never became a visit is queued with an owner until someone records what they did (AT-07)", () =>
    inRollback(async (tx) => {
      const s = await liveShop(tx, ["OK1,Lee,lee@example.com,2026-10-02", ",Smith,smith@example.com,2026-10-02"]);
      const rows = (await ops.listOperatorItems(tx)).filter((i) => i.subjectType === "import_row" && i.shopId === s.id);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({ kind: "held_import", owner: null, revision: 0, title: "Held row 2 · ops.csv" });
      expect(row.reason).toContain("Visit identity unclear");
      expect(row.href).toMatch(/^\/psg\/imports\/[0-9a-f-]{36}$/);

      const operator = await staffUser(tx);
      const owned = await ops.assignOwner(tx, operator, "import_row", row.subjectId, operator.userId, 0);
      await expect(ops.reviewItem(tx, operator, "import_row", row.subjectId, owned.revision, "ok")).rejects.toMatchObject({ kind: "invalid" });
      await expect(ops.reviewItem(tx, operator, "invitation", row.subjectId, owned.revision, "Fixed it in the source")).rejects.toMatchObject({ kind: "invalid" });
      await ops.reviewItem(tx, operator, "import_row", row.subjectId, owned.revision, "Shop sent the RO; it comes in the next file");
      expect((await ops.listOperatorItems(tx)).some((i) => i.subjectType === "import_row" && i.subjectId === row.subjectId)).toBe(false);
      const history = await tx.select().from(auditEvent).where(and(eq(auditEvent.subjectType, "import_row"), eq(auditEvent.subjectId, row.subjectId)));
      expect(history.map((h) => h.action).sort()).toEqual(["operator.owner_assigned", "operator.row_reviewed"]);
      expect(history.every((h) => h.shopId === s.id)).toBe(true);
    }));

  it("a failed email appears with its error, can be retried, and keeps the original error in history (AT-38)", () =>
    inRollback(async (tx) => {
      const s = await liveShop(tx, ["F1,Smith,f1@example.com,2026-09-10"]);
      const intentId = await queueInitial(tx, s.id, "F1");
      let now = Date.now();
      for (let i = 0; i < 10; i++) {
        now += hours(1);
        const p = await ledger.prepareNext(tx, "w", links, new Date(now), { intentIds: [intentId] });
        if (p.kind !== "send") break;
        await ledger.recordOutcome(tx, p.intentId, p.tokenId, "w", { result: "rejected", error: "550 mailbox unavailable" }, new Date(now));
      }
      const [failed] = await tx.select({ state: emailIntent.state }).from(emailIntent).where(eq(emailIntent.id, intentId));
      expect(failed.state).toBe("failed");

      const item = await itemFor(tx, intentId);
      expect(item).toMatchObject({ kind: "delivery", subjectType: "email_intent", shopId: s.id });
      expect(item?.provenance).toContain("550 mailbox unavailable");
      expect(item?.history.some((h) => h.action === "email.rejected" && h.detail === "550 mailbox unavailable")).toBe(true);

      const operator = await staffUser(tx);
      await ledger.resolveProblem(tx, operator, intentId, "retry", "", new Date());
      expect(await itemFor(tx, intentId)).toBeUndefined();
      const history = await tx.select({ action: auditEvent.action, after: auditEvent.after }).from(auditEvent).where(and(eq(auditEvent.subjectType, "email_intent"), eq(auditEvent.subjectId, intentId)));
      expect(history.filter((h) => h.action === "email.rejected").every((h) => (h.after as { error: string }).error === "550 mailbox unavailable")).toBe(true);
      expect(history.map((h) => h.action)).toContain("email.retry");
    }));

  it("an email with an unknown provider outcome is its own queue", () =>
    inRollback(async (tx) => {
      const s = await liveShop(tx, ["U1,Smith,u1@example.com,2026-09-10"]);
      const intentId = await queueInitial(tx, s.id, "U1");
      const p = await ledger.prepareNext(tx, "w", links, new Date(), { intentIds: [intentId] });
      if (p.kind !== "send") throw new Error("expected a send");
      await ledger.recordOutcome(tx, p.intentId, p.tokenId, "w", { result: "unknown", error: "Provider timed out" }, new Date());
      const item = await itemFor(tx, intentId);
      expect(item).toMatchObject({ kind: "email_unknown" });
      expect(item?.reason).toBe("Outcome unknown");
      expect(item?.provenance).toContain("Provider timed out");
    }));

  it("lists responses waiting for a visit match", () =>
    inRollback(async (tx) => {
      const s = await liveShop(tx, []);
      const answers = { overall_rating: 5, ready_on_time: "yes", service_aspects: { communication: "excellent", quality: "excellent", cleanliness: "excellent" }, recommend_score: 10 };
      const paper = await staff.submitPaper(tx, system, { shopId: s.id, visitId: null, receivedOn: "2026-09-20", answers, requestKey: `k-${unique()}` });
      const item = await itemFor(tx, paper.responseId);
      expect(item).toMatchObject({ kind: "pending_match", subjectType: "survey_response", shopId: s.id, href: `/psg/responses/${paper.responseId}` });
      expect(item?.provenance).toBe("Paper form received 2026-09-20");
    }));

  it("flags a suppression change as overdue after 24 hours", () =>
    inRollback(async (tx) => {
      const s = await liveShop(tx, []);
      const answers = { overall_rating: 5, ready_on_time: "yes", service_aspects: { communication: "excellent", quality: "excellent", cleanliness: "excellent" }, recommend_score: 10 };
      const paper = await staff.submitPaper(tx, system, { shopId: s.id, visitId: null, receivedOn: "2026-09-20", answers, requestKey: `k-${unique()}` });
      const raised = new Date(Date.now() - hours(2));
      const [action] = await tx
        .insert(suppressionAction)
        .values({ responseId: paper.responseId, ruleId: "r1", ruleLabel: "Stop routine mail", desired: "apply", sourceRevision: 1, isTest: false, createdAt: raised })
        .returning();
      expect(await itemFor(tx, action.id)).toMatchObject({ kind: "suppression", overdue: false });
      expect(await itemFor(tx, action.id, new Date(raised.getTime() + hours(24)))).toMatchObject({ kind: "suppression", overdue: true });
    }));

  it("assigns and clears an owner with revision checks, and shows it in history", () =>
    inRollback(async (tx) => {
      const s = await liveShop(tx, ["O1,Smith,,"]);
      const inv = await invitationFor(tx, s.id, "O1");
      const operator = await staffUser(tx);
      const other = await staffUser(tx);
      const outsider = await staffUser(tx, null);

      const first = await ops.assignOwner(tx, operator, "invitation", inv.id, operator.userId, 0);
      expect(first.revision).toBe(1);
      let item = await itemFor(tx, inv.id);
      expect(item?.owner?.userId).toBe(operator.userId);
      expect(item?.history[0]).toMatchObject({ action: "operator.owner_assigned" });

      // A stale page cannot overwrite a newer assignment.
      await expect(ops.assignOwner(tx, other, "invitation", inv.id, other.userId, 0)).rejects.toMatchObject({ kind: "conflict" });
      await expect(ops.assignOwner(tx, operator, "invitation", inv.id, outsider.userId, 1)).rejects.toMatchObject({ kind: "invalid" });
      await expect(ops.assignOwner(tx, operator, "alert_case", inv.id, operator.userId, 1)).rejects.toMatchObject({ kind: "not_found" });
      await expect(ops.assignOwner(tx, operator, "invitation", "00000000-0000-4000-8000-000000000000", operator.userId, 0)).rejects.toMatchObject({ kind: "not_found" });

      const handed = await ops.assignOwner(tx, operator, "invitation", inv.id, other.userId, 1);
      expect(handed.revision).toBe(2);
      const cleared = await ops.assignOwner(tx, other, "invitation", inv.id, null, 2);
      expect(cleared.revision).toBe(3);
      item = await itemFor(tx, inv.id);
      expect(item?.owner).toBeNull();
      expect(item?.history.map((h) => h.action)).toEqual(["operator.owner_cleared", "operator.owner_assigned", "operator.owner_assigned"]);
    }));

  it("sums up queue age, delivery and bridge health for the Overview, production data only (SR-48)", () =>
    inRollback(async (tx) => {
      const before = await ops.healthSnapshot(tx);
      const s = await liveShop(tx, ["Q1,Smith,q1@example.com,2026-09-10"]);
      const intentId = await queueInitial(tx, s.id, "Q1");
      const after = await ops.healthSnapshot(tx);
      expect(intentId).toBeTruthy();
      // The Live import queued one production email that is due now.
      expect(after.email.queued).toBe(before.email.queued + 1);
      expect(after.email.oldestDue).not.toBeNull();
      expect(typeof after.bridge.waiting).toBe("number");
      // Held needs a release, so it counts; a bounce is final and must not keep the count up forever.
      await tx.update(emailIntent).set({ state: "held" }).where(eq(emailIntent.id, intentId!));
      expect((await ops.healthSnapshot(tx)).email.problems).toBe(before.email.problems + 1);
      await tx.update(emailIntent).set({ state: "bounced" }).where(eq(emailIntent.id, intentId!));
      expect((await ops.healthSnapshot(tx)).email.problems).toBe(before.email.problems);
      // Two days from now nobody has heard from the worker.
      expect((await ops.healthSnapshot(tx, new Date(Date.now() + 48 * 3_600_000))).worker.healthy).toBe(false);
    }));

  it("reports a stopped worker, and a failed job until someone reviews it", () =>
    inRollback(async (tx) => {
      const later = new Date(Date.now() + hours(48));
      const items = await ops.listOperatorItems(tx, later);
      expect(items.find((i) => i.subjectType === "worker")).toMatchObject({ kind: "worker", overdue: true, subjectId: "heartbeat" });

      const present = (await tx.execute<{ present: boolean }>(sql`SELECT to_regclass('pgboss.job') IS NOT NULL AS present`)).rows[0].present;
      if (!present) return;
      const [job] = (
        await tx.execute<{ id: string }>(sql`INSERT INTO pgboss.job (name, state, output, started_on, completed_on) VALUES ('email.dispatch', 'failed', '{"message":"connection refused","stack":"secret stack"}', now(), now()) RETURNING id::text AS id`)
      ).rows;
      const item = await itemFor(tx, job.id);
      expect(item).toMatchObject({ kind: "worker", subjectType: "worker_job", reason: "connection refused" });
      expect(JSON.stringify(item)).not.toContain("secret stack");

      const operator = await staffUser(tx);
      await expect(ops.reviewItem(tx, operator, "worker_job", job.id, 0, "ok")).rejects.toMatchObject({ kind: "invalid" });
      await ops.reviewItem(tx, operator, "worker_job", job.id, 0, "Database restarted; next cycle ran fine");
      expect(await itemFor(tx, job.id)).toBeUndefined();
      await expect(ops.reviewItem(tx, operator, "worker_job", job.id, 1, "Again, twice")).rejects.toMatchObject({ kind: "conflict" });
      const [audit] = await tx.select().from(auditEvent).where(and(eq(auditEvent.subjectType, "worker_job"), eq(auditEvent.subjectId, job.id)));
      expect(audit).toMatchObject({ action: "operator.failure_reviewed", actorUserId: operator.userId });
    }));
});
