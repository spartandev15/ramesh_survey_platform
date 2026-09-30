import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { inOrder, type Tx } from "@/db/client";
import {
  auditEvent,
  customer,
  emailIntent,
  importBatch,
  importRow,
  instrumentVersion,
  invitation,
  legacyCase,
  legacySurveyLedger,
  repairVisit,
  shop,
  shopOptOut,
  shopSurveySettings,
  testRecipientAllowlist,
  user,
} from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { matchesTestAllowlist } from "@/modules/shops/settings-policy";
import { CsvError, parseCsv } from "./csv";
import { planVisitRow, type ExistingVisit, type ReasonCode, type RowPlan, type ShopFacts } from "./eligibility";
import { guessMapping, mappingIssues, normalizeLedgerRow, normalizeLegacyCaseRow, normalizeOptOutRow, normalizeVisitRow, type ImportKind, type Mapping, type NormalizedLegacyCase, type NormalizedVisit } from "./mapping";

/**
 * Import persistence (SR-06..SR-10). Runs inside the caller's transaction and
 * does NOT authorize: call through `imports.ts`. Upload stages rows; preview
 * computes outcomes without writing; commit writes stable row outcomes.
 */

export type Actor = { type: "user"; userId: string } | { type: "system" };

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
/** Known source systems. A visit key is unique per shop and source (SR-07). */
export const SOURCE_SYSTEMS = { shop_documents: "Shop documents" } as const;
export type SourceSystem = keyof typeof SOURCE_SYSTEMS;

export class ImportError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export type RowAction = "created" | "reused" | "held" | "excluded" | "rejected";
export type BatchCounts = Record<RowAction, number>;

const emptyCounts = (): BatchCounts => ({ created: 0, reused: 0, held: 0, excluded: 0, rejected: 0 });

function auditActor(actor: Actor) {
  return actor.type === "user" ? { actorType: "user" as const, actorUserId: actor.userId } : { actorType: "system" as const };
}

const actorId = (actor: Actor) => (actor.type === "user" ? actor.userId : null);

/** Keep a failed upload's provenance and error: file name, size, SHA-256 and why it was refused. */
export async function recordRejectedFile(tx: Tx, actor: Actor, input: { shopId: string; kind: string; isTest: boolean; fileName: string; content: string }, error: string) {
  const [target] = await tx.select({ id: shop.id }).from(shop).where(eq(shop.id, input.shopId));
  if (!target) return;
  await recordAudit(
    {
      ...auditActor(actor),
      shopId: target.id,
      action: "import.file_rejected",
      subjectType: "shop",
      subjectId: target.id,
      after: {
        kind: input.kind,
        isTest: input.isTest,
        fileName: input.fileName.slice(0, 200),
        bytes: Buffer.byteLength(input.content, "utf8"),
        sourceHash: createHash("sha256").update(input.content, "utf8").digest("hex"),
        error,
      },
    },
    tx,
  );
}

/** The latest refused files, newest first, for the imports page. */
export async function listRejectedFiles(tx: Tx, limit = 5) {
  const rows = await tx
    .select({ at: auditEvent.occurredAt, after: auditEvent.after, shopName: shop.name, actorName: user.name })
    .from(auditEvent)
    .leftJoin(shop, eq(shop.id, auditEvent.shopId))
    .leftJoin(user, eq(user.id, auditEvent.actorUserId))
    .where(eq(auditEvent.action, "import.file_rejected"))
    .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, after: r.after as { fileName: string; bytes: number; sourceHash: string; error: string; isTest: boolean } }));
}

export async function createBatch(
  tx: Tx,
  actor: Actor,
  input: { shopId: string; kind: ImportKind; isTest: boolean; sourceSystem: string; fileName: string; content: string },
) {
  if (!(input.sourceSystem in SOURCE_SYSTEMS)) throw new ImportError("invalid", "Choose where the records come from.");
  const [target] = await tx.select().from(shop).where(eq(shop.id, input.shopId));
  if (!target || target.archivedAt) throw new ImportError("not_found", "Choose a shop.");
  // An internal test shop holds only test data (SR-37).
  if (target.isTestShop && !input.isTest) throw new ImportError("invalid", "An internal test shop can only receive test data.");
  if (input.kind !== "visits" && input.isTest) throw new ImportError("invalid", "Legacy history, cases and opt-out lists are production data. Import them as production data.");
  if (Buffer.byteLength(input.content, "utf8") > MAX_IMPORT_BYTES) throw new ImportError("invalid", "The file is larger than 5 MB. Split it into smaller files.");

  let table;
  try {
    table = parseCsv(input.content);
  } catch (error) {
    if (error instanceof CsvError) throw new ImportError("invalid", error.message);
    throw error;
  }
  if (table.rows.length === 0) throw new ImportError("invalid", "The file has a header row but no records.");
  if (table.rows.length > MAX_IMPORT_ROWS) throw new ImportError("invalid", `The file has more than ${MAX_IMPORT_ROWS} records. Split it into smaller files.`);

  const [batch] = await tx
    .insert(importBatch)
    .values({
      shopId: input.shopId,
      kind: input.kind,
      isTest: input.isTest,
      sourceSystem: input.sourceSystem,
      fileName: input.fileName.slice(0, 200),
      sourceHash: createHash("sha256").update(input.content, "utf8").digest("hex"),
      headers: table.headers,
      mapping: guessMapping(table.headers, input.kind),
      rowCount: table.rows.length,
      createdBy: actorId(actor),
    })
    .returning();

  const rows = table.rows.map((values, index) => ({
    batchId: batch.id,
    rowNumber: index + 1,
    raw: Object.fromEntries(table.headers.map((h, c) => [h, values[c]])),
  }));
  for (let i = 0; i < rows.length; i += 500) await tx.insert(importRow).values(rows.slice(i, i + 500));

  await recordAudit(
    {
      ...auditActor(actor),
      shopId: input.shopId,
      action: "import.uploaded",
      subjectType: "import_batch",
      subjectId: batch.id,
      after: { kind: batch.kind, isTest: batch.isTest, fileName: batch.fileName, sourceHash: batch.sourceHash, rowCount: batch.rowCount },
    },
    tx,
  );
  return batch;
}

export type BatchRow = typeof importBatch.$inferSelect;

async function lockBatch(tx: Tx, batchId: string, expectedRevision: number) {
  const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, batchId)).for("update");
  if (!batch) throw new ImportError("not_found", "This import no longer exists.");
  if (batch.status !== "preview") throw new ImportError("conflict", "This import was already committed.");
  if (batch.revision !== expectedRevision) throw new ImportError("conflict", "This import changed since you opened it. Reload the page.");
  return batch;
}

export async function setMapping(tx: Tx, batchId: string, expectedRevision: number, mapping: Mapping) {
  const batch = await lockBatch(tx, batchId, expectedRevision);
  const clean = Object.fromEntries(Object.entries(mapping).filter(([, header]) => header));
  const issues = mappingIssues(clean, batch.headers, batch.kind);
  if (issues.some((i) => i.startsWith("Unknown") || i.includes("not in the file"))) throw new ImportError("invalid", "The column mapping is not valid.", issues);
  const [updated] = await tx.update(importBatch).set({ mapping: clean, revision: batch.revision + 1 }).where(eq(importBatch.id, batchId)).returning();
  return updated;
}

async function getBatch(tx: Tx, batchId: string) {
  const [batch] = await tx.select().from(importBatch).where(eq(importBatch.id, batchId));
  return batch ?? null;
}

export async function countBatches(tx: Tx) {
  const [row] = await tx.select({ n: count() }).from(importBatch);
  return row.n;
}

export async function listBatches(tx: Tx, offset: number, size: number, oldestFirst = false) {
  return tx
    .select({ batch: importBatch, shopName: shop.name })
    .from(importBatch)
    .innerJoin(shop, eq(shop.id, importBatch.shopId))
    .orderBy(...(oldestFirst ? [asc(importBatch.createdAt), asc(importBatch.id)] : [desc(importBatch.createdAt), desc(importBatch.id)]))
    .limit(size)
    .offset(offset);
}

/** What every committed production upload did, added up; test uploads never add to it (SR-03). */
export async function batchTotals(tx: Tx): Promise<BatchCounts> {
  const [row] = await tx.execute<BatchCounts>(sql`
    SELECT coalesce(sum((counts->>'created')::int), 0)::int AS created, coalesce(sum((counts->>'reused')::int), 0)::int AS reused,
      coalesce(sum((counts->>'held')::int), 0)::int AS held, coalesce(sum((counts->>'excluded')::int), 0)::int AS excluded,
      coalesce(sum((counts->>'rejected')::int), 0)::int AS rejected
    FROM import_batch WHERE counts IS NOT NULL AND NOT is_test`).then((r) => r.rows);
  return row ?? emptyCounts();
}

async function listRows(tx: Tx, batchId: string) {
  return tx.select().from(importRow).where(eq(importRow.batchId, batchId)).orderBy(asc(importRow.rowNumber));
}

// ---------------------------------------------------------------------------
// Planning: the same facts drive preview and commit
// ---------------------------------------------------------------------------

interface PlanContext {
  shop: ShopFacts & { isTestShop: boolean };
  versionId: string | null;
  versionIsTest: boolean | null;
  additionVersionId: string | null;
  additionIsTest: boolean;
  existing: Map<string, ExistingVisit>;
  legacy: Map<string, { invited: boolean; completed: boolean }>;
  optedOut: Set<string>;
  allowlist: string[];
}

async function loadShopFacts(tx: Tx, shopId: string) {
  const [row] = await tx
    .select({ settings: shopSurveySettings, isTestShop: shop.isTestShop, versionIsTest: instrumentVersion.isTest })
    .from(shopSurveySettings)
    .innerJoin(shop, eq(shop.id, shopSurveySettings.shopId))
    .leftJoin(instrumentVersion, eq(instrumentVersion.id, shopSurveySettings.instrumentVersionId))
    .where(eq(shopSurveySettings.shopId, shopId));
  if (!row) throw new ImportError("not_found", "This shop has no survey settings.");
  // The shop's own questions are pinned on new invitations too (SR-45).
  const additionVersionId = row.settings.additionVersionId;
  const [addition] = additionVersionId ? await tx.select({ isTest: instrumentVersion.isTest }).from(instrumentVersion).where(eq(instrumentVersion.id, additionVersionId)) : [];
  return {
    shop: {
      mode: row.settings.mode,
      deliveryCutoff: row.settings.deliveryCutoff,
      legacyCoverageConfirmed: row.settings.legacyCoverageConfirmedAt !== null,
      isTestShop: row.isTestShop,
    },
    versionId: row.settings.instrumentVersionId,
    versionIsTest: row.versionIsTest,
    additionVersionId,
    additionIsTest: Boolean(addition?.isTest),
  };
}

async function loadExisting(tx: Tx, batch: BatchRow, keys: string[], lock: boolean) {
  const existing = new Map<string, ExistingVisit>();
  if (keys.length === 0) return existing;
  const query = tx
    .select({ key: repairVisit.sourceVisitKey, deliveredOn: repairVisit.deliveredOn, emailNormalized: customer.emailNormalized, lastName: customer.lastName })
    .from(repairVisit)
    .innerJoin(customer, eq(customer.id, repairVisit.customerId))
    .where(and(eq(repairVisit.shopId, batch.shopId), eq(repairVisit.sourceSystem, batch.sourceSystem), eq(repairVisit.isTest, batch.isTest), inArray(repairVisit.sourceVisitKey, keys)));
  const rows = lock ? await query.for("update", { of: repairVisit }) : await query;
  for (const r of rows) existing.set(r.key, { sourceVisitKey: r.key, deliveredOn: r.deliveredOn, emailNormalized: r.emailNormalized, lastName: r.lastName });
  return existing;
}

async function buildContext(tx: Tx, batch: BatchRow, visits: NormalizedVisit[], lock: boolean): Promise<PlanContext> {
  const keys = [...new Set(visits.map((v) => v.sourceVisitKey).filter((k): k is string => Boolean(k)))];
  const emails = [...new Set(visits.map((v) => v.emailNormalized).filter((e): e is string => Boolean(e)))];
  const facts = await loadShopFacts(tx, batch.shopId);
  const [existing, ledger, optOuts, allowlist] = await inOrder([
    loadExisting(tx, batch, keys, lock),
    keys.length
      ? tx
          .select({ key: legacySurveyLedger.sourceVisitKey, completedOn: legacySurveyLedger.completedOn })
          .from(legacySurveyLedger)
          .where(and(eq(legacySurveyLedger.shopId, batch.shopId), eq(legacySurveyLedger.sourceSystem, batch.sourceSystem), inArray(legacySurveyLedger.sourceVisitKey, keys)))
      : Promise.resolve([]),
    emails.length ? tx.select({ email: shopOptOut.emailNormalized }).from(shopOptOut).where(and(eq(shopOptOut.shopId, batch.shopId), inArray(shopOptOut.emailNormalized, emails))) : Promise.resolve([]),
    tx.select({ entry: testRecipientAllowlist.entry }).from(testRecipientAllowlist),
  ]);
  return {
    ...facts,
    existing,
    legacy: new Map(ledger.map((l) => [l.key, { invited: true, completed: l.completedOn !== null }])),
    optedOut: new Set(optOuts.map((o) => o.email)),
    allowlist: allowlist.map((a) => a.entry),
  };
}

function planFor(ctx: PlanContext, batch: BatchRow, row: NormalizedVisit): RowPlan {
  const existing = row.sourceVisitKey ? (ctx.existing.get(row.sourceVisitKey) ?? null) : null;
  return planVisitRow(
    row,
    existing,
    {
      isTest: batch.isTest,
      legacy: row.sourceVisitKey ? (ctx.legacy.get(row.sourceVisitKey) ?? null) : null,
      optedOut: row.emailNormalized ? ctx.optedOut.has(row.emailNormalized) : false,
      recipientAllowlisted: row.emailNormalized ? matchesTestAllowlist(row.emailNormalized, ctx.allowlist) : false,
    },
    ctx.shop,
  );
}

/** The stored row action. A created-but-held invitation counts as held (AT-06). */
function rowAction(plan: RowPlan): RowAction {
  if (plan.action !== "created") return plan.action;
  return plan.status === "eligible" ? "created" : plan.status;
}

/** Remember a planned visit so a repeat of the same key later in the file is a duplicate. */
function rememberInFile(ctx: PlanContext, row: NormalizedVisit, plan: RowPlan) {
  if (plan.action === "created" && row.sourceVisitKey) {
    ctx.existing.set(row.sourceVisitKey, { sourceVisitKey: row.sourceVisitKey, emailNormalized: row.emailNormalized, lastName: row.lastName, deliveredOn: row.deliveredOn });
  }
}

function commitIssues(batch: BatchRow, ctx: Pick<PlanContext, "versionId" | "versionIsTest" | "additionIsTest">): string[] {
  const issues = mappingIssues(batch.mapping as Mapping, batch.headers, batch.kind);
  if (batch.kind === "visits") {
    if (!ctx.versionId) issues.push("Assign a survey version to this shop before importing visits.");
    // Production invitations are pinned to their version, so it must be verified content (AT-14).
    else if (!batch.isTest && ctx.versionIsTest) issues.push("Production records need a verified survey version. The shop has a TEST version assigned.");
    else if (!batch.isTest && ctx.additionIsTest) issues.push("Production records need verified shop questions. The shop's questions are a TEST version.");
  }
  return issues;
}

export interface PreviewRow {
  rowNumber: number;
  raw: Record<string, string>;
  action: RowAction;
  reasons: ReasonCode[] | string[];
  send: boolean;
}

/** What committing would do, without writing anything. */
export async function previewBatch(tx: Tx, batchId: string) {
  const batch = await getBatch(tx, batchId);
  if (!batch) throw new ImportError("not_found", "This import no longer exists.");
  const rows = await listRows(tx, batchId);
  const mapping = batch.mapping as Mapping;
  const counts = emptyCounts();

  if (batch.status === "committed") {
    for (const r of rows) counts[r.action ?? "rejected"]++;
    return { batch, issues: [], counts, rows: rows.map((r) => ({ rowNumber: r.rowNumber, raw: r.raw as Record<string, string>, action: r.action ?? "rejected", reasons: r.reasons, send: false })) };
  }

  if (batch.kind === "legacy_cases") {
    const existing = await existingLegacyCases(tx, batch, rows.map((r) => normalizeLegacyCaseRow(r.raw as Record<string, string>, mapping)));
    const seen = new Set<string>();
    const preview = rows.map((r) => {
      const plan = planLegacyCase(normalizeLegacyCaseRow(r.raw as Record<string, string>, mapping), existing, seen);
      counts[plan.action]++;
      return { rowNumber: r.rowNumber, raw: r.raw as Record<string, string>, action: plan.action, reasons: plan.reasons, send: false };
    });
    return { batch, issues: mappingIssues(mapping, batch.headers, batch.kind), counts, rows: preview };
  }

  if (batch.kind === "opt_outs") {
    const optOuts = rows.map((r) => normalizeOptOutRow(r.raw as Record<string, string>, mapping));
    const known = await existingOptOuts(tx, batch.shopId, optOuts);
    const seen = new Set<string>();
    const preview = rows.map((r, i) => {
      const plan = planOptOut(optOuts[i], known, seen);
      counts[plan.action]++;
      return { rowNumber: r.rowNumber, raw: r.raw as Record<string, string>, action: plan.action, reasons: plan.reasons, send: false };
    });
    return { batch, issues: mappingIssues(mapping, batch.headers, batch.kind), counts, rows: preview };
  }

  if (batch.kind === "legacy_ledger") {
    const preview = rows.map((r) => {
      const plan = planLedgerRow(normalizeLedgerRow(r.raw as Record<string, string>, mapping));
      counts[plan.action]++;
      return { rowNumber: r.rowNumber, raw: r.raw as Record<string, string>, action: plan.action, reasons: plan.reasons, send: false };
    });
    return { batch, issues: mappingIssues(mapping, batch.headers, batch.kind), counts, rows: preview };
  }

  const visits = rows.map((r) => normalizeVisitRow(r.raw as Record<string, string>, mapping));
  const ctx = await buildContext(tx, batch, visits, false);
  const preview: PreviewRow[] = rows.map((r, i) => {
    const plan = planFor(ctx, batch, visits[i]);
    rememberInFile(ctx, visits[i], plan);
    const action = rowAction(plan);
    counts[action]++;
    return { rowNumber: r.rowNumber, raw: r.raw as Record<string, string>, action, reasons: plan.reasons, send: plan.action === "created" && plan.send };
  });
  return { batch, issues: commitIssues(batch, ctx), counts, rows: preview };
}

/** Cases already imported for this shop and source, by legacy case id, with whether Hub has taken them over. */
async function existingLegacyCases(tx: Tx, batch: BatchRow, cases: NormalizedLegacyCase[], lock = false) {
  const refs = [...new Set(cases.map((c) => c.caseRef).filter((r): r is string => Boolean(r)))];
  if (refs.length === 0) return new Map<string, { id: string; inHub: boolean }>();
  const query = tx
    .select({ id: legacyCase.id, ref: legacyCase.sourceRef, handedOffAt: legacyCase.handedOffAt })
    .from(legacyCase)
    .where(and(eq(legacyCase.shopId, batch.shopId), eq(legacyCase.sourceSystem, batch.sourceSystem), inArray(legacyCase.sourceRef, refs)));
  const rows = lock ? await query.for("update") : await query;
  return new Map(rows.map((r) => [r.ref, { id: r.id, inHub: r.handedOffAt !== null }]));
}

/**
 * One legacy case row (SR-46). A repeat of a known case updates it while it
 * is still with the legacy owner and never touches one Hub has taken over,
 * so repeated imports never create a second active case (AT-46).
 */
function planLegacyCase(row: NormalizedLegacyCase, existing: Map<string, { id: string; inHub: boolean }>, seen: Set<string>): { action: RowAction; reasons: string[] } {
  if (!row.caseRef) return { action: "rejected", reasons: ["CASE_ID_MISSING"] };
  if (!row.status) return { action: "rejected", reasons: ["STATUS_UNKNOWN"] };
  if (row.invalidDate) return { action: "rejected", reasons: ["DATE_INVALID"] };
  if (seen.has(row.caseRef)) return { action: "rejected", reasons: ["CASE_REPEATED_IN_FILE"] };
  seen.add(row.caseRef);
  const known = existing.get(row.caseRef);
  const reference = row.status === "closed" ? ["CLOSED_REFERENCE_ONLY"] : [];
  if (known?.inHub) return { action: "reused", reasons: ["ALREADY_IN_HUB"] };
  if (known) return { action: "reused", reasons: ["UPDATED_FROM_LEGACY", ...reference] };
  return { action: "created", reasons: reference };
}

async function existingOptOuts(tx: Tx, shopId: string, rows: { emailNormalized: string | null }[]) {
  const emails = [...new Set(rows.map((r) => r.emailNormalized).filter((e): e is string => Boolean(e)))];
  if (emails.length === 0) return new Set<string>();
  const found = await tx.select({ email: shopOptOut.emailNormalized }).from(shopOptOut).where(and(eq(shopOptOut.shopId, shopId), inArray(shopOptOut.emailNormalized, emails)));
  return new Set(found.map((f) => f.email));
}

/** One opt-out row: a usable address is recorded once per shop; a repeat is kept as a duplicate. */
function planOptOut(row: { emailRaw: string | null; emailNormalized: string | null }, known: Set<string>, seen: Set<string>): { action: RowAction; reasons: string[] } {
  if (!row.emailNormalized) return { action: "rejected", reasons: [row.emailRaw ? "EMAIL_INVALID" : "EMAIL_MISSING"] };
  if (known.has(row.emailNormalized)) return { action: "reused", reasons: ["ALREADY_OPTED_OUT"] };
  if (seen.has(row.emailNormalized)) return { action: "reused", reasons: ["EMAIL_REPEATED_IN_FILE"] };
  seen.add(row.emailNormalized);
  return { action: "created", reasons: [] };
}

function planLedgerRow(row: ReturnType<typeof normalizeLedgerRow>): { action: RowAction; reasons: string[] } {
  if (!row.sourceVisitKey) return { action: "rejected", reasons: ["VISIT_ID_MISSING"] };
  if (row.invalidDates) return { action: "rejected", reasons: ["DATE_INVALID"] };
  return { action: "created", reasons: [] };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * Write every row's outcome in one transaction. Visit identity is protected
 * by a unique index, so a concurrent import of the same visit waits and then
 * reuses it (AT-07). Eligible new visits get one initial email intent; email
 * leaves only through the dispatcher after its own recheck (SR-26).
 */
export async function commitBatch(tx: Tx, actor: Actor, batchId: string, expectedRevision: number, now = new Date()) {
  const batch = await lockBatch(tx, batchId, expectedRevision);
  const rows = await listRows(tx, batchId);
  const mapping = batch.mapping as Mapping;
  const counts = emptyCounts();

  if (batch.kind === "legacy_cases") {
    const issues = mappingIssues(mapping, batch.headers, batch.kind);
    if (issues.length > 0) throw new ImportError("invalid", "Fix the column mapping before committing.", issues);
    const cases = rows.map((r) => normalizeLegacyCaseRow(r.raw as Record<string, string>, mapping));
    // Locked, so a handoff cannot happen between this check and the update below.
    const existing = await existingLegacyCases(tx, batch, cases, true);
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const row = cases[i];
      let plan = planLegacyCase(row, existing, seen);
      const legacyFields = {
        legacyStatus: row.status!,
        openedOn: row.openedOn,
        summary: row.summary,
        legacyOwner: row.legacyOwner,
        visitKey: row.visitKey,
        customerName: row.customerName,
        responseRef: row.responseRef,
        legacyNotes: row.notes,
        importRowId: rows[i].id,
      };
      if (plan.action === "created") {
        const [inserted] = await tx
          .insert(legacyCase)
          .values({ shopId: batch.shopId, sourceSystem: batch.sourceSystem, sourceRef: row.caseRef!, ...legacyFields, createdAt: now, updatedAt: now })
          .onConflictDoNothing()
          .returning({ id: legacyCase.id });
        // A concurrent import created it first: this row is a repeat, not a second case.
        if (!inserted) plan = { action: "reused", reasons: ["DUPLICATE_CASE"] };
      } else if (plan.action === "reused" && !plan.reasons.includes("ALREADY_IN_HUB")) {
        await tx.update(legacyCase).set({ ...legacyFields, revision: sql`${legacyCase.revision} + 1`, updatedAt: now }).where(eq(legacyCase.id, existing.get(row.caseRef!)!.id));
      }
      counts[plan.action]++;
      await tx.update(importRow).set({ action: plan.action, reasons: plan.reasons, processedAt: now }).where(eq(importRow.id, rows[i].id));
    }
    return finish(tx, actor, batch, counts, now);
  }

  if (batch.kind === "opt_outs") {
    const issues = mappingIssues(mapping, batch.headers, batch.kind);
    if (issues.length > 0) throw new ImportError("invalid", "Fix the column mapping before committing.", issues);
    const optOuts = rows.map((r) => normalizeOptOutRow(r.raw as Record<string, string>, mapping));
    const known = await existingOptOuts(tx, batch.shopId, optOuts);
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      let plan = planOptOut(optOuts[i], known, seen);
      if (plan.action === "created") {
        const [inserted] = await tx
          .insert(shopOptOut)
          .values({ shopId: batch.shopId, emailNormalized: optOuts[i].emailNormalized!, source: `import:${batch.id}`, createdAt: now })
          .onConflictDoNothing()
          .returning({ id: shopOptOut.id });
        // Recorded by a customer or another import at the same moment: already opted out.
        if (!inserted) plan = { action: "reused", reasons: ["ALREADY_OPTED_OUT"] };
      }
      counts[plan.action]++;
      await tx.update(importRow).set({ action: plan.action, reasons: plan.reasons, processedAt: now }).where(eq(importRow.id, rows[i].id));
    }
    return finish(tx, actor, batch, counts, now);
  }

  if (batch.kind === "legacy_ledger") {
    const issues = mappingIssues(mapping, batch.headers, batch.kind);
    if (issues.length > 0) throw new ImportError("invalid", "Fix the column mapping before committing.", issues);
    for (const r of rows) {
      const row = normalizeLedgerRow(r.raw as Record<string, string>, mapping);
      let plan = planLedgerRow(row);
      if (plan.action === "created") {
        const [inserted] = await tx
          .insert(legacySurveyLedger)
          .values({ shopId: batch.shopId, sourceSystem: batch.sourceSystem, sourceVisitKey: row.sourceVisitKey!, invitedOn: row.invitedOn, completedOn: row.completedOn, responseRef: row.responseRef, importRowId: r.id })
          .onConflictDoNothing()
          .returning({ id: legacySurveyLedger.id });
        if (!inserted) plan = { action: "reused", reasons: ["DUPLICATE_VISIT"] };
      }
      counts[plan.action]++;
      await tx.update(importRow).set({ action: plan.action, reasons: plan.reasons, processedAt: now }).where(eq(importRow.id, r.id));
    }
    return finish(tx, actor, batch, counts, now);
  }

  const visits = rows.map((r) => normalizeVisitRow(r.raw as Record<string, string>, mapping));
  const ctx = await buildContext(tx, batch, visits, true);
  const issues = commitIssues(batch, ctx);
  if (issues.length > 0) throw new ImportError("invalid", "This import cannot be committed yet.", issues);

  for (let i = 0; i < rows.length; i++) {
    const row = visits[i];
    let plan = planFor(ctx, batch, row);
    let visitId: string | null = null;
    let invitationId: string | null = null;

    if (plan.action === "created") {
      const customerId = await findOrCreateCustomer(tx, batch, row);
      const [visit] = await tx
        .insert(repairVisit)
        .values({
          shopId: batch.shopId,
          customerId,
          isTest: batch.isTest,
          sourceSystem: batch.sourceSystem,
          sourceVisitKey: row.sourceVisitKey!,
          repairOrder: row.repairOrder,
          deliveredOn: row.deliveredOn,
          deliveredOnRaw: row.deliveredOnRaw,
          importRowId: rows[i].id,
        })
        .onConflictDoNothing()
        .returning({ id: repairVisit.id });
      if (!visit) {
        // Another import created this visit after we looked: plan again against it.
        const fresh = await loadExisting(tx, batch, [row.sourceVisitKey!], true);
        ctx.existing.set(row.sourceVisitKey!, fresh.get(row.sourceVisitKey!)!);
        plan = planFor(ctx, batch, row);
      } else {
        visitId = visit.id;
        const [inv] = await tx
          .insert(invitation)
          .values({
            shopId: batch.shopId,
            instrumentVersionId: ctx.versionId!,
            additionVersionId: ctx.additionVersionId,
            isTest: batch.isTest,
            visitId,
            importRowId: rows[i].id,
            status: plan.status,
            reasons: plan.reasons,
            createdBy: actorId(actor),
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: invitation.id });
        invitationId = inv.id;
        if (plan.send) {
          await tx.insert(emailIntent).values({
            invitationId,
            kind: "initial",
            idempotencyKey: `invitation:${invitationId}:initial`,
            recipient: row.emailNormalized!,
            isTest: batch.isTest,
            createdBy: actorId(actor),
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
    if (plan.action === "reused") {
      const [found] = await tx
        .select({ visitId: repairVisit.id, invitationId: invitation.id })
        .from(repairVisit)
        .leftJoin(invitation, eq(invitation.visitId, repairVisit.id))
        .where(and(eq(repairVisit.shopId, batch.shopId), eq(repairVisit.sourceSystem, batch.sourceSystem), eq(repairVisit.isTest, batch.isTest), eq(repairVisit.sourceVisitKey, row.sourceVisitKey!)));
      visitId = found?.visitId ?? null;
      invitationId = found?.invitationId ?? null;
    }

    rememberInFile(ctx, row, plan);
    const action = rowAction(plan);
    counts[action]++;
    await tx.update(importRow).set({ action, reasons: plan.reasons, visitId, invitationId, processedAt: now }).where(eq(importRow.id, rows[i].id));
  }
  return finish(tx, actor, batch, counts, now);
}

async function findOrCreateCustomer(tx: Tx, batch: BatchRow, row: NormalizedVisit): Promise<string> {
  // Reuse a customer by email at this shop; email identifies the person, not the visit.
  if (row.emailNormalized) {
    const [found] = await tx
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.shopId, batch.shopId), eq(customer.isTest, batch.isTest), eq(customer.emailNormalized, row.emailNormalized)))
      .limit(1);
    if (found) return found.id;
  }
  const [created] = await tx
    .insert(customer)
    .values({ shopId: batch.shopId, isTest: batch.isTest, firstName: row.firstName, lastName: row.lastName, email: row.email, emailNormalized: row.emailNormalized, phone: row.phone })
    .returning({ id: customer.id });
  return created.id;
}

async function finish(tx: Tx, actor: Actor, batch: BatchRow, counts: BatchCounts, now: Date) {
  const [updated] = await tx
    .update(importBatch)
    .set({ status: "committed", counts, committedAt: now, committedBy: actorId(actor), revision: batch.revision + 1 })
    .where(eq(importBatch.id, batch.id))
    .returning();
  await recordAudit({ ...auditActor(actor), shopId: batch.shopId, action: "import.committed", subjectType: "import_batch", subjectId: batch.id, after: { counts } }, tx);
  return updated;
}
