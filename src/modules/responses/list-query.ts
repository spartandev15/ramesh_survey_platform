import { SOURCE_LABELS } from "./labels";
import type { MatchStatus, ResponseFilters } from "./staff-store";

/**
 * The response list's address as filters, shared by the page and its CSV
 * export so both always cover the same responses. Unknown values fall back
 * to "all".
 */
const QUEUE_TABS = ["visit_unmatched", "shop_unconfirmed", "duplicate_review"] as const satisfies readonly MatchStatus[];
export const STATE_OPTIONS = { counted: "Counted", not_counted: "Not counted" } as const;
export const PERIOD_OPTIONS = { 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days", 365: "Last 12 months" } as const;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseResponseQuery(params: Params): ResponseFilters {
  const tab = one(params.status);
  const source = one(params.source);
  const state = one(params.state);
  const since = Number(one(params.since));
  const q = one(params.q).trim().slice(0, 100);
  return {
    ...((QUEUE_TABS as readonly string[]).includes(tab) ? { matchStatus: tab as MatchStatus } : {}),
    ...(source in SOURCE_LABELS ? { source: source as NonNullable<ResponseFilters["source"]> } : {}),
    ...(state in STATE_OPTIONS ? { counted: state === "counted" } : {}),
    ...(since in PERIOD_OPTIONS ? { sinceDays: since } : {}),
    ...(q ? { q } : {}),
  };
}

/** The responses ticked for export (?id=…&id=…); anything that is not an id is ignored. */
export function selectedIds(params: Params): string[] {
  const raw = params.id;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return [...new Set(list.filter((v) => UUID_RE.test(v)))].slice(0, 1000);
}
