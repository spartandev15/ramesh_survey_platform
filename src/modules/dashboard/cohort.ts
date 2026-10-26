import { isIsoDate } from "@/modules/shops/settings-policy";
import { answerFilterParam, parseAnswerFilter, type AnswerFilter } from "./answers";

/**
 * Dashboard cohort rules (SR-27, SR-28, SR-31). Pure logic so the dashboard
 * and its export are computed identically and every rule is unit-tested
 * (AT-31: a filtered export reconciles to the same dashboard cohort).
 */

export type DateBasis = "submitted" | "delivered";
export type SourceFilter = "all" | "online" | "paper" | "public";

export interface DashboardFilters {
  from: string;
  to: string;
  basis: DateBasis;
  source: SourceFilter;
  /** "all" or an instrument version id. */
  version: string;
  /** Only responses with this answer; applied where answers are loaded (store.cohortRows). */
  answer: AnswerFilter | null;
}

export const DATE_BASIS_LABELS: Record<DateBasis, string> = { submitted: "Date submitted", delivered: "Date vehicle delivered" };
export const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = { all: "All sources", online: "Online link", paper: "Paper", public: "Public form" };

const DAY = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A shop-local calendar date for an instant. */
export function localDate(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Filters from URL parameters. Anything unknown falls back to the default: the last 90 days by submission. */
export function parseFilters(params: Record<string, string | string[] | undefined>, today: string): DashboardFilters {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const fallbackFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 89 * DAY).toISOString().slice(0, 10);
  let from = isIsoDate(one("from")) ? one("from") : fallbackFrom;
  let to = isIsoDate(one("to")) ? one("to") : today;
  if (from > to) [from, to] = [to, from];
  const basis = one("basis") === "delivered" ? "delivered" : "submitted";
  const source = (["online", "paper", "public"] as const).find((s) => s === one("source")) ?? "all";
  const version = UUID_RE.test(one("version")) ? one("version") : "all";
  return { from, to, basis, source, version, answer: parseAnswerFilter(one("answer")) };
}

export function filtersToQuery(f: DashboardFilters): string {
  return new URLSearchParams({ from: f.from, to: f.to, basis: f.basis, source: f.source, version: f.version, ...(f.answer ? { answer: answerFilterParam(f.answer) } : {}) }).toString();
}

export type Category = "counted" | "pending_match" | "duplicate" | "legacy_reference" | "excluded_test";

export const CATEGORY_LABELS: Record<Category, string> = {
  counted: "Counted",
  pending_match: "Pending customer match",
  duplicate: "Duplicate, not counted",
  legacy_reference: "Legacy reference, not counted",
  excluded_test: "Test data, not counted",
};

export interface CohortRow {
  id: string;
  submittedAt: Date;
  deliveredOn: string | null;
  source: "online" | "paper" | "public";
  isTest: boolean;
  matchStatus: "shop_unconfirmed" | "visit_unmatched" | "matched" | "duplicate_review";
  canonical: boolean;
  duplicateDisposition: string | null;
  versionId: string;
  metrics: Record<string, number | null>;
  alerts: { id: string; label: string }[];
}

/**
 * Where a submitted response stands for reporting. Only the canonical,
 * matched response of a visit is scored; test data never enters a
 * production shop's scores (SR-03), but an internal test shop shows its own.
 */
export function categorize(row: Pick<CohortRow, "isTest" | "matchStatus" | "canonical" | "duplicateDisposition">, shopIsTest: boolean): Category {
  if (row.isTest && !shopIsTest) return "excluded_test";
  if (row.matchStatus === "visit_unmatched" || row.matchStatus === "shop_unconfirmed") return "pending_match";
  if (row.canonical) return "counted";
  if (row.duplicateDisposition === "legacy_reference") return "legacy_reference";
  return "duplicate";
}

/** Rows inside the filters. Delivery-date basis needs a matched visit, so unmatched rows drop out of it. */
export function inCohort(row: CohortRow, f: DashboardFilters, timezone: string): boolean {
  const date = f.basis === "submitted" ? localDate(row.submittedAt, timezone) : row.deliveredOn;
  if (!date || date < f.from || date > f.to) return false;
  if (f.source !== "all" && row.source !== f.source) return false;
  if (f.version !== "all" && row.versionId !== f.version) return false;
  return true;
}

export interface MetricSummary {
  id: string;
  label: string;
  average: number | null;
  /** Responses that had a value; missing is not zero (PDF 04). */
  n: number;
  /** A 0..1 share (ratio_of_max, share_matching), shown as a percentage; the stored value is unchanged. */
  share: boolean;
}

export interface VersionGroup {
  versionId: string;
  label: string;
  counted: number;
  withAlerts: number;
  metrics: MetricSummary[];
  /** Counted responses per time bucket; buckets without responses are left out, so a line never dips to a false zero. */
  trend: { bucket: string; counted: number; metrics: Record<string, number | null> }[];
}

export type Granularity = "day" | "week" | "month";

/** Buckets that keep a chart readable: days up to six weeks, weeks up to about seven months, then months. */
export function granularityFor(from: string, to: string): Granularity {
  const days = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  return days <= 45 ? "day" : days <= 210 ? "week" : "month";
}

/** The bucket a shop-local date falls in: the day itself, the Monday of its week, or its month. */
export function bucketOf(date: string, granularity: Granularity): string {
  if (granularity === "day") return date;
  if (granularity === "month") return date.slice(0, 7);
  const d = Date.parse(`${date}T00:00:00Z`);
  return new Date(d - ((new Date(d).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}

/** Every bucket from one date to another, so a quiet week shows as zero instead of disappearing. */
export function bucketsBetween(from: string, to: string, granularity: Granularity): string[] {
  const out: string[] = [];
  let cursor = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const key = bucketOf(new Date(cursor).toISOString().slice(0, 10), granularity);
    if (out[out.length - 1] !== key) out.push(key);
    cursor += DAY;
  }
  return out;
}

/** The date a row is reported under: the same date the filter uses. */
const reportDate = (row: CohortRow, basis: DateBasis, timezone: string) => (basis === "submitted" ? localDate(row.submittedAt, timezone) : (row.deliveredOn ?? localDate(row.submittedAt, timezone)));

export interface VersionInfo {
  label: string;
  /** `share`: the formula gives a share from 0 to 1, shown as a percentage. */
  metrics: { id: string; label: string; share?: boolean }[];
}

function average(values: (number | null | undefined)[]): { average: number | null; n: number } {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return { average: present.length ? present.reduce((a, b) => a + b, 0) / present.length : null, n: present.length };
}

/**
 * Scores per survey version. Different versions are never averaged together,
 * because their questions and scales may differ (AT-30, PDF 04 "version compatibility").
 */
export function summarize(rows: CohortRow[], shopIsTest: boolean, versions: Map<string, VersionInfo>, timezone: string, range: Pick<DashboardFilters, "from" | "to" | "basis">) {
  const granularity = granularityFor(range.from, range.to);
  const bucket = (row: CohortRow) => bucketOf(reportDate(row, range.basis, timezone), granularity);
  const counts: Record<Category, number> = { counted: 0, pending_match: 0, duplicate: 0, legacy_reference: 0, excluded_test: 0 };
  const sources = { online: 0, paper: 0, public: 0 };
  const volume = new Map(bucketsBetween(range.from, range.to, granularity).map((b) => [b, { bucket: b, counted: 0, other: 0 }]));
  const counted: CohortRow[] = [];
  let withAlerts = 0;
  for (const row of rows) {
    const c = categorize(row, shopIsTest);
    counts[c]++;
    sources[row.source]++;
    if (row.alerts.length > 0) withAlerts++;
    const v = volume.get(bucket(row));
    if (v) v[c === "counted" ? "counted" : "other"]++;
    if (c === "counted") counted.push(row);
  }

  const byVersion = new Map<string, CohortRow[]>();
  for (const row of counted) byVersion.set(row.versionId, [...(byVersion.get(row.versionId) ?? []), row]);

  const groups: VersionGroup[] = [...byVersion.entries()].map(([versionId, list]) => {
    const info = versions.get(versionId) ?? { label: "Unknown version", metrics: [] };
    const buckets = new Map<string, CohortRow[]>();
    for (const row of list) {
      const key = bucket(row);
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return {
      versionId,
      label: info.label,
      counted: list.length,
      withAlerts: list.filter((r) => r.alerts.length > 0).length,
      metrics: info.metrics.map((m) => ({ id: m.id, label: m.label, share: m.share ?? false, ...average(list.map((r) => r.metrics[m.id])) })),
      trend: [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, bucketRows]) => ({
          bucket: key,
          counted: bucketRows.length,
          metrics: Object.fromEntries(info.metrics.map((m) => [m.id, average(bucketRows.map((r) => r.metrics[m.id])).average])),
        })),
    };
  });
  groups.sort((a, b) => b.counted - a.counted);
  return { total: rows.length, counts, sources, withAlerts, granularity, volume: [...volume.values()], groups };
}
