/**
 * Database integration tests for instrument versioning (SR-15, AT-15).
 * They run against DATABASE_URL (loaded from .env when present) and roll back
 * every change, so they leave no data behind. Skipped when no database is configured.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("instrument versions in the database", async () => {
  const { getDb, getPool } = await import("@/db/client");
  const { auditEvent, instrumentVersion } = await import("@/db/schema");
  const store = await import("./store");
  const { demoDefinition } = await import("./demo-definition");
  const { emptyDefinition } = await import("./definition");
  type Tx = import("@/db/client").Tx;

  const actor = { type: "system" } as const;
  class Rollback extends Error {}

  /** Run a test body in a transaction that is always rolled back. */
  async function inRollback(body: (tx: Tx) => Promise<void>) {
    await expect(
      getDb().transaction(async (tx) => {
        await body(tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  const uniqueKey = () => `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  afterAll(async () => {
    await getPool().end();
  });

  it("creates a survey with an editable draft and rejects stale edits", () =>
    inRollback(async (tx) => {
      const { draft } = await store.insertInstrument(tx, actor, { key: uniqueKey(), name: "Test survey" }, emptyDefinition());
      expect(draft).toMatchObject({ version: 1, status: "draft", revision: 1, isTest: true });

      const saved = await store.saveDraft(tx, actor, draft.id, 1, demoDefinition);
      expect(saved.revision).toBe(2);
      await expect(store.saveDraft(tx, actor, draft.id, 1, demoDefinition)).rejects.toBeInstanceOf(store.InstrumentConflictError);
    }));

  it("refuses to publish an invalid definition", () =>
    inRollback(async (tx) => {
      const { draft } = await store.insertInstrument(tx, actor, { key: uniqueKey(), name: "Empty" }, emptyDefinition());
      await expect(store.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true })).rejects.toBeInstanceOf(store.DefinitionInvalidError);
    }));

  it("requires a source note to publish a non-test version (AT-14)", () =>
    inRollback(async (tx) => {
      const { draft } = await store.insertInstrument(tx, actor, { key: uniqueKey(), name: "Verified" }, demoDefinition);
      await expect(store.publishVersion(tx, actor, draft.id, draft.revision, { isTest: false })).rejects.toBeInstanceOf(store.DefinitionInvalidError);
      const published = await store.publishVersion(tx, actor, draft.id, draft.revision, { isTest: false, sourceNote: "Approved export v1, sha256 abc" });
      expect(published.isTest).toBe(false);
    }));

  it("makes a published version immutable at the database level", () =>
    inRollback(async (tx) => {
      const { draft } = await store.insertInstrument(tx, actor, { key: uniqueKey(), name: "Immutable" }, demoDefinition);
      const published = await store.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });
      expect(published.definitionHash).toMatch(/^[0-9a-f]{64}$/);

      // Savepoints, because each rejected statement aborts its transaction.
      await expect(
        tx.transaction((sp) => sp.update(instrumentVersion).set({ definition: emptyDefinition() }).where(eq(instrumentVersion.id, published.id))),
      ).rejects.toThrow();
      await expect(tx.transaction((sp) => sp.delete(instrumentVersion).where(eq(instrumentVersion.id, published.id)))).rejects.toThrow();
      await expect(store.saveDraft(tx, actor, published.id, published.revision, demoDefinition)).rejects.toBeInstanceOf(store.InstrumentConflictError);

      const [row] = await tx.select().from(instrumentVersion).where(eq(instrumentVersion.id, published.id));
      expect(row.definitionHash).toBe(published.definitionHash);
    }));

  it("creates the next version as a new draft and allows only one open draft", () =>
    inRollback(async (tx) => {
      const { draft } = await store.insertInstrument(tx, actor, { key: uniqueKey(), name: "Versioned" }, demoDefinition);
      const v1 = await store.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });

      const v2 = await store.createDraftFrom(tx, actor, v1.id);
      expect(v2).toMatchObject({ version: 2, status: "draft", basedOnVersionId: v1.id });
      expect(v2.definition).toEqual(v1.definition);

      await expect(tx.transaction((sp) => store.createDraftFrom(sp, actor, v1.id))).rejects.toBeInstanceOf(store.InstrumentConflictError);
    }));

  it("duplicates a version into a new survey without touching the source", () =>
    inRollback(async (tx) => {
      const { draft } = await store.insertInstrument(tx, actor, { key: uniqueKey(), name: "Original" }, demoDefinition);
      const v1 = await store.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });
      const copy = await store.duplicateInstrument(tx, actor, v1.id, { key: uniqueKey(), name: "Copy" });
      expect(copy.draft).toMatchObject({ version: 1, status: "draft" });
      expect(copy.draft.definition).toEqual(v1.definition);
      expect(copy.instrument.id).not.toBe(v1.instrumentId);
    }));

  it("discards a later draft but never a published version or the only version", () =>
    inRollback(async (tx) => {
      const { draft } = await store.insertInstrument(tx, actor, { key: uniqueKey(), name: "Discard" }, demoDefinition);
      await expect(store.discardDraft(tx, actor, draft.id, draft.revision)).rejects.toBeInstanceOf(store.InstrumentConflictError);
      const v1 = await store.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });
      await expect(store.discardDraft(tx, actor, v1.id, v1.revision)).rejects.toBeInstanceOf(store.InstrumentConflictError);

      const v2 = await store.createDraftFrom(tx, actor, v1.id);
      await store.discardDraft(tx, actor, v2.id, v2.revision);
      expect(await store.findVersion(tx, v2.id)).toBeNull();
      expect(await store.findVersion(tx, v1.id)).not.toBeNull();
    }));

  it("audits creation and publication in the same transaction", () =>
    inRollback(async (tx) => {
      const { draft } = await store.insertInstrument(tx, actor, { key: uniqueKey(), name: "Audited" }, demoDefinition);
      await store.publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });
      const events = await tx
        .select({ action: auditEvent.action })
        .from(auditEvent)
        .where(sql`${auditEvent.subjectId} = ${draft.id} OR ${auditEvent.subjectId} = ${draft.instrumentId}`);
      expect(events.map((e) => e.action).sort()).toEqual(["instrument.created", "instrument_version.published"]);
    }));
});
