import "server-only";
import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { historicalResponse, instrument, instrumentVersion, shop, surveyResponse } from "@/db/schema";
import { combineDefinitions, parseDefinition, type InstrumentDefinition } from "@/modules/instruments/definition";
import { allQuestions } from "@/modules/instruments/questions";
import type { Answers, Outcomes } from "@/modules/instruments/evaluate";
import { matchesAnswer } from "./answers";
import { categorize, inCohort, type CohortRow, type DashboardFilters, type VersionInfo } from "./cohort";

/**
 * Dashboard reads (SR-27, SR-30, SR-31). Always scoped by the shop id the
 * caller has already authorized; runs inside the caller's transaction.
 * Every figure comes from the current revision of each response, so a
 * correction replaces the old score exactly once (PDF 04).
 */

const DAY = 24 * 60 * 60 * 1000;

export interface DashboardRow extends CohortRow {
  /** The shop's own questions this response answered (SR-45); exported, never scored. */
  additionVersionId: string | null;
  answers: Answers;
  revision: number;
  visitKey: string | null;
}

export async function shopForDashboard(tx: Tx, shopId: string) {
  const [row] = await tx.select({ id: shop.id, name: shop.name, timezone: shop.timezone, isTestShop: shop.isTestShop, archivedAt: shop.archivedAt }).from(shop).where(eq(shop.id, shopId));
  return row && !row.archivedAt ? row : null;
}

/** Submitted responses for the shop inside the filters, newest first. */
/** `withAnswers: false` leaves out the answer sets when only scores are needed. An answer filter always loads them. */
/** The most responses one dashboard view reads; a longer range has to be narrowed. */
const COHORT_LIMIT = 20000;

export async function cohortRows(tx: Tx, shopId: string, filters: DashboardFilters, timezone: string, { withAnswers = true } = {}): Promise<DashboardRow[] & { truncated: boolean }> {
  const answer = filters.answer;
  if (answer) withAnswers = true;
  // A generous UTC window first; the exact shop-local date filter runs in inCohort.
  const window =
    filters.basis === "submitted"
      ? sql`r.submitted_at >= ${new Date(Date.parse(filters.from) - DAY)} AND r.submitted_at < ${new Date(Date.parse(filters.to) + 2 * DAY)}`
      : sql`v.delivered_on BETWEEN ${filters.from} AND ${filters.to}`;
  const result = await tx.execute<{
    id: string;
    submitted_at: Date;
    delivered_on: string | null;
    source: "online" | "paper" | "public";
    is_test: boolean;
    match_status: CohortRow["matchStatus"];
    canonical: boolean;
    duplicate_disposition: string | null;
    instrument_version_id: string;
    addition_version_id: string | null;
    visit_key: string | null;
    revision: number;
    answers: Answers;
    outcomes: Outcomes;
  }>(sql`
    SELECT r.id, r.submitted_at, v.delivered_on, r.source, r.is_test, r.match_status, r.canonical,
           r.duplicate_disposition, r.instrument_version_id, r.addition_version_id, v.source_visit_key AS visit_key,
           rev.revision, ${withAnswers ? sql`rev.answers` : sql`NULL::jsonb`} AS answers, rev.outcomes
    FROM survey_response r
    LEFT JOIN repair_visit v ON v.id = r.visit_id
    JOIN LATERAL (
      SELECT revision, ${withAnswers ? sql`answers` : sql`NULL::jsonb AS answers`}, outcomes FROM response_revision
      WHERE response_id = r.id ORDER BY revision DESC LIMIT 1
    ) rev ON true
    WHERE r.shop_id = ${shopId} AND r.status = 'submitted' AND ${window}
    ORDER BY r.submitted_at DESC
    LIMIT ${COHORT_LIMIT}
  `);
  const rows = result.rows
    .map((r) => ({
      id: r.id,
      submittedAt: new Date(r.submitted_at),
      deliveredOn: r.delivered_on,
      source: r.source,
      isTest: r.is_test,
      matchStatus: r.match_status,
      canonical: r.canonical,
      duplicateDisposition: r.duplicate_disposition,
      versionId: r.instrument_version_id,
      additionVersionId: r.addition_version_id,
      metrics: r.outcomes.metrics ?? {},
      alerts: r.outcomes.alerts ?? [],
      answers: r.answers,
      revision: r.revision,
      visitKey: r.visit_key,
    }))
    .filter((r) => inCohort(r, filters, timezone) && (!answer || matchesAnswer(r.answers, answer)));
  // Hitting the cap means older responses in the range were left out: the page says so instead of showing short counts.
  return Object.assign(rows, { truncated: result.rows.length === COHORT_LIMIT });
}

export interface VersionDetail extends VersionInfo {
  definition: InstrumentDefinition;
  isTest: boolean;
}

export async function versionDetails(tx: Tx, versionIds: string[]): Promise<Map<string, VersionDetail>> {
  if (versionIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: instrumentVersion.id, version: instrumentVersion.version, isTest: instrumentVersion.isTest, definition: instrumentVersion.definition, name: instrument.name })
    .from(instrumentVersion)
    .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
    .where(inArray(instrumentVersion.id, versionIds));
  const map = new Map<string, VersionDetail>();
  for (const r of rows) {
    const parsed = parseDefinition(r.definition);
    if (!parsed.ok) continue;
    map.set(r.id, {
      label: `${r.name} v${r.version}${r.isTest ? " (TEST)" : ""}`,
      metrics: parsed.definition.metrics.map((m) => ({ id: m.id, label: m.label, share: m.method === "ratio_of_max" || m.method === "share_matching" })),
      definition: parsed.definition,
      isTest: r.isTest,
    });
  }
  return map;
}

/** Every version the shop has responses for, for the version filter. */
export async function shopVersions(tx: Tx, shopId: string) {
  const rows = await tx.selectDistinct({ id: surveyResponse.instrumentVersionId }).from(surveyResponse).where(and(eq(surveyResponse.shopId, shopId), eq(surveyResponse.status, "submitted")));
  const details = await versionDetails(
    tx,
    rows.map((r) => r.id),
  );
  return [...details.entries()].map(([id, d]) => ({ id, label: d.label, definition: d.definition }));
}

/** Surveys started but not submitted: shown so the reader knows they are not counted (SR-16). */
export async function draftCount(tx: Tx, shopId: string) {
  const [row] = await tx.select({ n: count() }).from(surveyResponse).where(and(eq(surveyResponse.shopId, shopId), eq(surveyResponse.status, "draft")));
  return row.n;
}

export interface HistoricalMeasure {
  key: string;
  scale: string;
  average: number | null;
  n: number;
}

/**
 * Historical responses, read-only and summarised per measure and scale.
 * They are never merged into new metrics until a documented compatible
 * mapping exists (SR-30, AT-30).
 */
export async function historicalSummary(tx: Tx, shopId: string, from: string, to: string) {
  const rows = await tx
    .select({ measures: historicalResponse.measures, sourceSystem: historicalResponse.sourceSystem })
    .from(historicalResponse)
    .where(and(eq(historicalResponse.shopId, shopId), gte(historicalResponse.respondedOn, from), lte(historicalResponse.respondedOn, to)));
  const groups = new Map<string, { key: string; scale: string; values: number[] }>();
  for (const r of rows) {
    for (const [key, m] of Object.entries((r.measures ?? {}) as Record<string, { value: number | null; scale: string }>)) {
      const g = groups.get(`${key}|${m.scale}`) ?? { key, scale: m.scale, values: [] };
      if (typeof m.value === "number" && Number.isFinite(m.value)) g.values.push(m.value);
      groups.set(`${key}|${m.scale}`, g);
    }
  }
  const measures: HistoricalMeasure[] = [...groups.values()].map((g) => ({ key: g.key, scale: g.scale, n: g.values.length, average: g.values.length ? g.values.reduce((a, b) => a + b, 0) / g.values.length : null }));
  return { responses: rows.length, sources: [...new Set(rows.map((r) => r.sourceSystem))], measures };
}

/** One response of this shop for the shop's own detail page. PSG-only matching details are not included. */
export async function shopResponse(tx: Tx, shopId: string, responseId: string, shopIsTest: boolean) {
  const [r] = await tx.select().from(surveyResponse).where(and(eq(surveyResponse.id, responseId), eq(surveyResponse.shopId, shopId), eq(surveyResponse.status, "submitted")));
  // A response whose shop is not yet confirmed never reaches a shop (AT-29).
  if (!r || r.matchStatus === "shop_unconfirmed") return null;
  const result = await tx.execute<{ revision: number; answers: Answers; outcomes: Outcomes; created_at: Date }>(
    sql`SELECT revision, answers, outcomes, created_at FROM response_revision WHERE response_id = ${responseId} ORDER BY revision DESC LIMIT 1`,
  );
  const latest = result.rows[0];
  const versions = await versionDetails(tx, r.additionVersionId ? [r.instrumentVersionId, r.additionVersionId] : [r.instrumentVersionId]);
  const version = versions.get(r.instrumentVersionId);
  if (!latest || !version) return null;
  // The shop's own questions follow the shared ones (SR-45).
  const definition = combineDefinitions(version.definition, r.additionVersionId ? (versions.get(r.additionVersionId)?.definition ?? null) : null);
  return {
    id: r.id,
    submittedAt: r.submittedAt!,
    source: r.source,
    receivedOn: r.receivedOn,
    isTest: r.isTest,
    category: categorize(r, shopIsTest),
    revision: latest.revision,
    correctedAt: latest.revision > 1 ? new Date(latest.created_at) : null,
    answers: latest.answers,
    outcomes: latest.outcomes,
    version: { label: version.label },
    definition,
    questions: allQuestions(definition),
  };
}
