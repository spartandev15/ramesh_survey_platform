import "server-only";
import { and, asc, count, desc, eq, max, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { instrument, instrumentVersion, shop } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { definitionHash } from "./canonical";
import { ADDITION_PREFIX, DEFINITION_SCHEMA_VERSION, parseDefinition, validateDefinition, type DefinitionIssue, type InstrumentDefinition } from "./definition";
import type { InstrumentInput } from "./validation";

/**
 * Instrument persistence. These functions run inside the caller's transaction
 * and do NOT authorize: call them through `instruments.ts` (which checks the
 * signed-in user) or from trusted scripts acting as the system.
 */

export type InstrumentRow = typeof instrument.$inferSelect;
export type InstrumentVersionRow = typeof instrumentVersion.$inferSelect;

export type Actor = { type: "user"; userId: string } | { type: "system" };

export class InstrumentConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "InstrumentConflictError";
  }
}

export class DefinitionInvalidError extends Error {
  readonly status = 422;
  constructor(readonly issues: DefinitionIssue[]) {
    super("The survey definition has problems that must be fixed first");
    this.name = "DefinitionInvalidError";
  }
}

export class InstrumentNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("Not found");
    this.name = "InstrumentNotFoundError";
  }
}

function auditActor(actor: Actor) {
  return actor.type === "user" ? { actorType: "user" as const, actorUserId: actor.userId } : { actorType: "system" as const };
}

function actorUserId(actor: Actor): string | null {
  return actor.type === "user" ? actor.userId : null;
}

/** Drafts must have a valid shape; cross-reference problems may remain until publish. */
function requireShape(input: unknown): InstrumentDefinition {
  const parsed = parseDefinition(input);
  if (!parsed.ok) throw new DefinitionInvalidError(parsed.issues);
  return parsed.definition;
}

function uniqueViolation(error: unknown): string | null {
  const e = (error as { cause?: unknown })?.cause ?? error;
  return (e as { code?: string })?.code === "23505" ? ((e as { constraint?: string }).constraint ?? "") : null;
}

export async function insertInstrument(
  tx: Tx,
  actor: Actor,
  input: InstrumentInput,
  definition: unknown,
  sourceNote?: string,
  shopId: string | null = null,
): Promise<{ instrument: InstrumentRow; draft: InstrumentVersionRow }> {
  const parsed = requireShape(definition);
  let created: InstrumentRow;
  try {
    [created] = await tx
      .insert(instrument)
      .values({ key: input.key, name: input.name, description: input.description ?? null, shopId, createdBy: actorUserId(actor) })
      .returning();
  } catch (error) {
    if (uniqueViolation(error) === "instrument_key_unique") throw new InstrumentConflictError("That survey key is already used");
    throw error;
  }
  const [draft] = await tx
    .insert(instrumentVersion)
    .values({ instrumentId: created.id, version: 1, definition: parsed, sourceNote: sourceNote ?? null, createdBy: actorUserId(actor) })
    .returning();

  await recordAudit(
    { ...auditActor(actor), action: "instrument.created", subjectType: "instrument", subjectId: created.id, after: { key: created.key, name: created.name, draftVersionId: draft.id } },
    tx,
  );
  return { instrument: created, draft };
}

/** Save a draft. `expectedRevision` must match, so a stale editor cannot overwrite newer work. */
export async function saveDraft(
  tx: Tx,
  actor: Actor,
  versionId: string,
  expectedRevision: number,
  definition: unknown,
  sourceNote?: string | null,
): Promise<InstrumentVersionRow> {
  const parsed = requireShape(definition);
  const [updated] = await tx
    .update(instrumentVersion)
    .set({
      definition: parsed,
      ...(sourceNote !== undefined ? { sourceNote } : {}),
      revision: sql`${instrumentVersion.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(instrumentVersion.id, versionId), eq(instrumentVersion.status, "draft"), eq(instrumentVersion.revision, expectedRevision)))
    .returning();
  if (!updated) throw await explainMissedUpdate(tx, versionId);

  await recordAudit(
    { ...auditActor(actor), action: "instrument_version.draft_saved", subjectType: "instrument_version", subjectId: versionId, after: { revision: updated.revision } },
    tx,
  );
  return updated;
}

/**
 * Publish a draft (SR-15). Full validation must pass. After this the database
 * rejects any change to the version. `isTest: false` marks PSG-verified
 * content and requires a source note (G-01, AT-14).
 */
export async function publishVersion(
  tx: Tx,
  actor: Actor,
  versionId: string,
  expectedRevision: number,
  options: { isTest: boolean; sourceNote?: string | null },
): Promise<InstrumentVersionRow> {
  const [current] = await tx.select().from(instrumentVersion).where(eq(instrumentVersion.id, versionId)).for("update");
  if (!current) throw new InstrumentNotFoundError();
  if (current.status !== "draft") throw new InstrumentConflictError("This version is already published");
  if (current.revision !== expectedRevision) throw new InstrumentConflictError("This draft changed since you opened it. Reload and try again.");

  const definition = requireShape(current.definition);
  const [owner] = await tx.select({ shopId: instrument.shopId }).from(instrument).where(eq(instrument.id, current.instrumentId));
  const issues = validateDefinition(definition, owner?.shopId ? "addition" : "core");
  if (issues.length > 0) throw new DefinitionInvalidError(issues);

  const sourceNote = options.sourceNote !== undefined ? options.sourceNote?.trim() || null : current.sourceNote;
  if (!options.isTest && !sourceNote) {
    throw new DefinitionInvalidError([{ path: "sourceNote", message: "Record the approved source before publishing a non-test version" }]);
  }

  const hash = definitionHash(definition);
  const [published] = await tx
    .update(instrumentVersion)
    .set({
      status: "published",
      isTest: options.isTest,
      definition,
      definitionHash: hash,
      sourceNote,
      publishedAt: new Date(),
      publishedBy: actorUserId(actor),
      updatedAt: new Date(),
    })
    .where(eq(instrumentVersion.id, versionId))
    .returning();

  await recordAudit(
    {
      ...auditActor(actor),
      action: "instrument_version.published",
      subjectType: "instrument_version",
      subjectId: versionId,
      after: { instrumentId: published.instrumentId, version: published.version, isTest: published.isTest, definitionHash: hash, sourceNote },
    },
    tx,
  );
  return published;
}

/** Start the next version from an existing one. Published versions are never edited in place. */
export async function createDraftFrom(tx: Tx, actor: Actor, fromVersionId: string): Promise<InstrumentVersionRow> {
  const [source] = await tx.select().from(instrumentVersion).where(eq(instrumentVersion.id, fromVersionId));
  if (!source) throw new InstrumentNotFoundError();

  // Serialize version numbering per survey.
  await tx.select({ id: instrument.id }).from(instrument).where(eq(instrument.id, source.instrumentId)).for("update");
  const [{ latest }] = await tx
    .select({ latest: max(instrumentVersion.version) })
    .from(instrumentVersion)
    .where(eq(instrumentVersion.instrumentId, source.instrumentId));

  let draft: InstrumentVersionRow;
  try {
    [draft] = await tx
      .insert(instrumentVersion)
      .values({
        instrumentId: source.instrumentId,
        version: (latest ?? 0) + 1,
        definition: source.definition,
        sourceNote: source.sourceNote,
        basedOnVersionId: source.id,
        createdBy: actorUserId(actor),
      })
      .returning();
  } catch (error) {
    if (uniqueViolation(error) === "instrument_version_one_draft") throw new InstrumentConflictError("This survey already has an open draft");
    throw error;
  }

  await recordAudit(
    {
      ...auditActor(actor),
      action: "instrument_version.draft_created",
      subjectType: "instrument_version",
      subjectId: draft.id,
      after: { instrumentId: draft.instrumentId, version: draft.version, basedOnVersionId: source.id },
    },
    tx,
  );
  return draft;
}

async function explainMissedUpdate(tx: Tx, versionId: string): Promise<Error> {
  const [row] = await tx.select({ status: instrumentVersion.status }).from(instrumentVersion).where(eq(instrumentVersion.id, versionId));
  if (!row) return new InstrumentNotFoundError();
  if (row.status !== "draft") return new InstrumentConflictError("Published versions cannot be edited. Create a new draft instead.");
  return new InstrumentConflictError("This draft changed since you opened it. Reload and try again.");
}

export interface InstrumentSummary extends InstrumentRow {
  versions: Omit<InstrumentVersionRow, "definition">[];
}

export async function listInstruments(tx: Tx): Promise<InstrumentSummary[]> {
  const instruments = await tx.select().from(instrument).orderBy(asc(instrument.name));
  const versions = await tx
    .select({
      id: instrumentVersion.id,
      instrumentId: instrumentVersion.instrumentId,
      version: instrumentVersion.version,
      status: instrumentVersion.status,
      isTest: instrumentVersion.isTest,
      definitionHash: instrumentVersion.definitionHash,
      sourceNote: instrumentVersion.sourceNote,
      revision: instrumentVersion.revision,
      basedOnVersionId: instrumentVersion.basedOnVersionId,
      createdAt: instrumentVersion.createdAt,
      createdBy: instrumentVersion.createdBy,
      updatedAt: instrumentVersion.updatedAt,
      publishedAt: instrumentVersion.publishedAt,
      publishedBy: instrumentVersion.publishedBy,
    })
    .from(instrumentVersion)
    .orderBy(desc(instrumentVersion.version));
  return instruments.map((i) => ({ ...i, versions: versions.filter((v) => v.instrumentId === i.id) }));
}

export async function findInstrument(tx: Tx, instrumentId: string): Promise<{ instrument: InstrumentRow; versions: InstrumentVersionRow[] } | null> {
  const [row] = await tx.select().from(instrument).where(eq(instrument.id, instrumentId));
  if (!row) return null;
  const versions = await tx.select().from(instrumentVersion).where(eq(instrumentVersion.instrumentId, instrumentId)).orderBy(desc(instrumentVersion.version));
  return { instrument: row, versions };
}

export async function findVersion(tx: Tx, versionId: string): Promise<InstrumentVersionRow | null> {
  const [row] = await tx.select().from(instrumentVersion).where(eq(instrumentVersion.id, versionId));
  return row ?? null;
}

/**
 * Copy a version's content into a brand-new survey (SR-44 duplication). The
 * copy starts as a draft; nothing about the source survey changes.
 */
export async function duplicateInstrument(
  tx: Tx,
  actor: Actor,
  fromVersionId: string,
  input: InstrumentInput,
): Promise<{ instrument: InstrumentRow; draft: InstrumentVersionRow }> {
  const [source] = await tx.select().from(instrumentVersion).where(eq(instrumentVersion.id, fromVersionId));
  if (!source) throw new InstrumentNotFoundError();
  // A copy of a shop's questions stays with that shop.
  const [owner] = await tx.select({ shopId: instrument.shopId }).from(instrument).where(eq(instrument.id, source.instrumentId));
  const created = await insertInstrument(tx, actor, input, source.definition, source.sourceNote ?? undefined, owner?.shopId ?? null);
  await recordAudit(
    {
      ...auditActor(actor),
      action: "instrument.duplicated",
      subjectType: "instrument",
      subjectId: created.instrument.id,
      after: { fromVersionId: source.id, fromInstrumentId: source.instrumentId },
    },
    tx,
  );
  return created;
}

/**
 * Discard an open draft. Published versions can never be deleted (the
 * database enforces it), and a survey's only version cannot be discarded.
 */
export async function discardDraft(tx: Tx, actor: Actor, versionId: string, expectedRevision: number): Promise<{ instrumentId: string }> {
  const [draft] = await tx.select().from(instrumentVersion).where(eq(instrumentVersion.id, versionId)).for("update");
  if (!draft) throw new InstrumentNotFoundError();
  if (draft.status !== "draft") throw new InstrumentConflictError("Published versions cannot be discarded");
  if (draft.revision !== expectedRevision) throw new InstrumentConflictError("This draft changed since you opened it. Reload and try again.");

  const [{ total }] = await tx.select({ total: count() }).from(instrumentVersion).where(eq(instrumentVersion.instrumentId, draft.instrumentId));
  if (total <= 1) throw new InstrumentConflictError("This is the survey's only version, so it cannot be discarded");

  await tx.delete(instrumentVersion).where(eq(instrumentVersion.id, versionId));
  await recordAudit(
    {
      ...auditActor(actor),
      action: "instrument_version.draft_discarded",
      subjectType: "instrument_version",
      subjectId: versionId,
      before: { instrumentId: draft.instrumentId, version: draft.version, revision: draft.revision },
    },
    tx,
  );
  return { instrumentId: draft.instrumentId };
}

/**
 * The shop's own additional questions (SR-45): one survey per shop, created on
 * first use, edited in the same builder and published like any version. They
 * are shown after the shared core and never scored.
 */
export async function createShopAddition(tx: Tx, actor: Actor, shopId: string): Promise<InstrumentRow> {
  // Lock the shop so two editors cannot create two addition surveys.
  const [target] = await tx.select({ id: shop.id, name: shop.name, slug: shop.publicSlug }).from(shop).where(eq(shop.id, shopId)).for("update");
  if (!target) throw new InstrumentNotFoundError();
  const [existing] = await tx.select().from(instrument).where(eq(instrument.shopId, shopId));
  if (existing) return existing;
  const definition: InstrumentDefinition = {
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    pages: [{ id: `${ADDITION_PREFIX}page_1`, title: `A few questions from ${target.name}`, questions: [] }],
    metrics: [],
    alerts: [],
    suppressions: [],
  };
  const key = `shop_${target.slug.replace(/[^a-z0-9]+/g, "_")}_questions`.slice(0, 63);
  const { instrument: created } = await insertInstrument(tx, actor, { key, name: `${target.name}: shop questions` }, definition, undefined, shopId);
  return created;
}

/** Published versions of a shop's own questions, newest first, for its settings. */
export async function listShopAdditionVersions(tx: Tx, shopId: string) {
  return tx
    .select({ id: instrumentVersion.id, instrumentId: instrument.id, version: instrumentVersion.version, isTest: instrumentVersion.isTest, status: instrumentVersion.status })
    .from(instrumentVersion)
    .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
    .where(eq(instrument.shopId, shopId))
    .orderBy(desc(instrumentVersion.version));
}
