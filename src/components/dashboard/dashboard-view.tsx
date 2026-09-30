import { Activity, AlertTriangle, CheckCircle2, ChevronRight, Clock, Download, FileText, History, PenLine, SlidersHorizontal, Star, ThumbsUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { CATEGORY_LABELS, DATE_BASIS_LABELS, filtersToQuery, SOURCE_FILTER_LABELS, type Category, type DashboardFilters, type Granularity } from "@/modules/dashboard/cohort";
import { LIST_VIEWS, type getDashboard, type ListView } from "@/modules/dashboard/dashboard";
import { Donut, Legend, TrendChart } from "./charts";

type Data = NonNullable<Awaited<ReturnType<typeof getDashboard>>>;

const SOURCE_LABELS: Record<string, string> = { online: "Online link", paper: "Paper", public: "Public form" };
const HISTORY_SOURCES: Record<string, string> = { supabase: "the previous survey system (Supabase)" };
const CATEGORY_STYLES: Record<Category, string> = {
  counted: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  pending_match: "bg-amber-50 text-amber-800 ring-amber-600/20",
  duplicate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  legacy_reference: "bg-slate-100 text-slate-700 ring-slate-500/20",
  excluded_test: "bg-amber-50 text-amber-800 ring-amber-600/20",
};
const C = {
  counted: "var(--color-chart-counted)",
  total: "var(--color-chart-total)",
  pending: "var(--color-chart-pending)",
  other: "var(--color-chart-other)",
  negative: "var(--color-chart-negative)",
  paper: "var(--color-chart-paper)",
  public: "var(--color-chart-public)",
};
const PER: Record<Granularity, string> = { day: "per day", week: "per week", month: "per month" };
const GRANULARITY_LABEL: Record<Granularity, string> = { day: "Daily", week: "Weekly", month: "Monthly" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
const METRIC_ICONS: LucideIcon[] = [Star, ThumbsUp, Activity];

/** "Sep 7" for a day or week, "Sep 2026" for a month. */
function bucketLabel(bucket: string): string {
  const [y, m, d] = bucket.split("-").map(Number);
  return d ? `${MONTHS[m - 1]} ${d}` : `${MONTHS[m - 1]} ${y}`;
}
const score = (v: number | null) => (v === null ? "No score yet" : String(Number(v.toFixed(2))));
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/** Second half of the period against the first, each weighted by its responses; steadier than first bucket against last. */
function halfChange(points: { value: number; weight: number }[]): { delta: number } | null {
  if (points.length < 2) return null;
  const mid = Math.floor(points.length / 2);
  const mean = (list: typeof points) => list.reduce((s, p) => s + p.value * p.weight, 0) / list.reduce((s, p) => s + p.weight, 0);
  return { delta: mean(points.slice(mid)) - mean(points.slice(0, mid)) };
}
const card = "rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm";
const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy-700";

/**
 * The survey dashboard (SR-27, SR-30, SR-31), shared by the shop workspace
 * and PSG. It states its date basis, filters and every excluded cohort, so a
 * reader knows exactly what the scores include; the charts use the same
 * cohort as the scores and the export.
 */
export function DashboardView({
  data,
  action,
  hidden,
  leading,
  responseHref,
  exportHref,
}: {
  data: Data;
  /** Where the filters submit (this page). */
  action: string;
  /** Extra fields to keep when filtering, e.g. the PSG shop picker. */
  hidden?: Record<string, string>;
  /** Shown first in the toolbar, e.g. the PSG shop picker. */
  leading?: React.ReactNode;
  responseHref: (id: string) => string;
  exportHref: string;
}) {
  const { summary, filters, today, versionOptions, drafts, history, list, listView } = data;
  // The page says dates use the shop's local time, so the list does too.
  const tz = data.shop.timezone;
  const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
  const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" });
  const { counts } = summary;
  const filterQuery = { ...hidden, ...Object.fromEntries(new URLSearchParams(filtersToQuery(filters))) };
  const href = (extra: Record<string, string>) => `${action}?${new URLSearchParams({ ...filterQuery, ...extra })}`;
  const versionLabel = filters.version === "all" ? "all survey versions" : (versionOptions.find((v) => v.id === filters.version)?.label ?? "one survey version");
  const notCounted = counts.duplicate + counts.legacy_reference + counts.excluded_test;
  const excluded: [string, number][] = (
    [
      ["waiting for a customer match", counts.pending_match],
      ["duplicates of a counted response", counts.duplicate],
      ["already surveyed in the legacy system", counts.legacy_reference],
      ["test data", counts.excluded_test],
    ] as [string, number][]
  ).filter(([, n]) => n > 0);
  const buckets = summary.volume.map((v) => v.bucket);
  const labels = buckets.map(bucketLabel);
  const presets = [
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
    { label: "12 months", days: 365 },
  ].map((p) => ({ ...p, from: new Date(Date.parse(`${today}T00:00:00Z`) - (p.days - 1) * DAY).toISOString().slice(0, 10) }));
  const activeFilters = [filters.basis !== "submitted", filters.source !== "all", filters.version !== "all"].filter(Boolean).length;
  const viewCounts: Record<ListView, number> = { all: summary.total, counted: counts.counted, pending: counts.pending_match, negative: summary.withAlerts, not_counted: notCounted };
  const sources = [
    { label: SOURCE_LABELS.online, value: summary.sources.online, color: C.total },
    { label: SOURCE_LABELS.paper, value: summary.sources.paper, color: C.paper },
    { label: SOURCE_LABELS.public, value: summary.sources.public, color: C.counted },
  ];
  const scoreParts = [
    { label: "Counted in scores", value: counts.counted, color: C.counted },
    { label: "Pending customer match", value: counts.pending_match, color: C.pending },
    { label: "Not counted (duplicates, legacy, test)", value: notCounted, color: "#d1d5db" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Shop, filters, period and export */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          {leading}
          <details className="group relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-400 [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Filters
              {activeFilters > 0 && <span className="rounded-full bg-indigo-600 px-1.5 text-xs text-white">{activeFilters}</span>}
            </summary>
            <form action={action} className="absolute left-0 z-30 mt-2 flex w-[min(92vw,22rem)] flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
              {Object.entries(hidden ?? {}).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <Filter id="basis" label="Date basis">
                <select id="basis" name="basis" defaultValue={filters.basis} className={field}>
                  {Object.entries(DATE_BASIS_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </Filter>
              <div className="grid grid-cols-2 gap-3">
                <Filter id="from" label="From">
                  <input id="from" name="from" type="date" defaultValue={filters.from} className={field} />
                </Filter>
                <Filter id="to" label="To">
                  <input id="to" name="to" type="date" defaultValue={filters.to} className={field} />
                </Filter>
              </div>
              <Filter id="source" label="Source">
                <select id="source" name="source" defaultValue={filters.source} className={field}>
                  {Object.entries(SOURCE_FILTER_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </Filter>
              <Filter id="version" label="Survey version">
                <select id="version" name="version" defaultValue={filters.version} className={field}>
                  <option value="all">All versions</option>
                  {versionOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Filter>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Link href={`${action}${hidden ? `?${new URLSearchParams(hidden)}` : ""}`} className="text-sm text-gray-600 hover:text-brand-navy-900">
                  Reset
                </Link>
                <button type="submit" className="rounded-lg bg-brand-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-brand-navy-700">
                  Apply
                </button>
              </div>
            </form>
          </details>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Date range" className="inline-flex h-10 items-center rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
            {presets.map((p) => {
              const active = filters.from === p.from && filters.to === today;
              return (
                <Link
                  key={p.label}
                  href={href({ from: p.from, to: today })}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-indigo-50 font-medium text-indigo-700" : "text-gray-600 hover:bg-gray-100 hover:text-brand-navy-900"}`}
                >
                  {p.label}
                </Link>
              );
            })}
          </nav>
          <a href={exportHref} className="flex h-10 items-center gap-2 rounded-xl bg-brand-navy-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-navy-700">
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </a>
        </div>
      </div>

      <p className="text-sm text-gray-600">
        {DATE_BASIS_LABELS[filters.basis]} from {filters.from} to {filters.to}, {SOURCE_FILTER_LABELS[filters.source].toLowerCase()}, {versionLabel}. Dates use the shop&apos;s local time.
        {filters.basis === "delivered" && " Responses not yet matched to a visit have no delivery date, so they are not in this view."}
      </p>

      <section aria-label="Response counts" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat icon={FileText} tone="blue" label="Submitted" value={summary.total} note="Total surveys received" />
        <Stat icon={CheckCircle2} tone="green" label="Counted in scores" value={counts.counted} note="Surveys used for scoring" />
        <Stat icon={Clock} tone="amber" label="Pending customer match" value={counts.pending_match} note="Waiting to match to a visit" />
        <Stat icon={AlertTriangle} tone="rose" label="With negative feedback" value={summary.withAlerts} note="Surveys that raised an alert" />
        <Stat icon={PenLine} tone="slate" label="Started, not submitted" value={drafts} note="Partial surveys, all dates" />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section aria-labelledby="volume-heading" className={`${card} lg:col-span-2`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="volume-heading" className="text-base font-semibold text-brand-navy-900">
                Responses over time
              </h2>
              <p className="text-xs text-gray-500">Total submitted vs. counted in scores, {PER[summary.granularity]}</p>
            </div>
            <span className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600">{GRANULARITY_LABEL[summary.granularity]}</span>
          </div>
          <div className="mt-4">
            <TrendChart
              id="volume"
              labels={labels}
              fromZero
              series={[
                { key: "total", label: "Submitted", color: C.total, area: true, values: summary.volume.map((v) => v.counted + v.other) },
                { key: "counted", label: "Counted", color: C.counted, area: true, values: summary.volume.map((v) => v.counted) },
              ]}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
            <Legend
              items={[
                { label: "Submitted", color: C.total },
                { label: "Counted in scores", color: C.counted },
              ]}
            />
          </div>
          <DataTable caption="Responses over time" head={["Period", "Submitted", "Counted"]} rows={summary.volume.filter((v) => v.counted + v.other > 0).map((v) => [bucketLabel(v.bucket), v.counted + v.other, v.counted])} />
        </section>

        <section aria-labelledby="mix-heading" className={card}>
          <h2 id="mix-heading" className="text-base font-semibold text-brand-navy-900">
            Where responses came from
          </h2>
          <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
            <Donut total={summary.total} caption="Submitted" size="size-32" thickness={6} parts={sources} />
            <div className="flex w-full min-w-0 flex-col gap-2.5 text-sm">
              {sources.map((s) => (
                <p key={s.label} className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-gray-600">{s.label}</span>
                  <span className="font-semibold tabular-nums text-brand-navy-900">{s.value}</span>
                  <span className="w-9 text-right text-xs tabular-nums text-gray-500">{pct(s.value, summary.total)}%</span>
                </p>
              ))}
            </div>
          </div>
          <h3 className="mt-6 text-sm font-semibold text-brand-navy-900">What counts in the scores</h3>
          <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            {summary.total > 0 && scoreParts.filter((p) => p.value > 0).map((p) => <div key={p.label} title={`${p.label}: ${p.value}`} className="h-full" style={{ width: `${pct(p.value, summary.total)}%`, background: p.color }} />)}
          </div>
          <div className="mt-3 flex flex-col gap-1.5 text-xs">
            {scoreParts.map((p) => (
              <p key={p.label} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-gray-600">{p.label}</span>
                <span className="font-semibold tabular-nums text-brand-navy-900">{p.value}</span>
                <span className="w-9 text-right tabular-nums text-gray-500">({pct(p.value, summary.total)}%)</span>
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            {excluded.length === 0 ? "Every submitted response in this view counts in the scores." : `Not in the scores: ${excluded.map(([what, n]) => `${n} ${what}`).join(", ")}. Drafts never count.`}
          </p>
        </section>
      </div>

      {summary.groups.length === 0 ? (
        <p className={`${card} text-center text-sm text-gray-500`}>No counted responses in this view yet.</p>
      ) : (
        summary.groups.slice(0, 1).map((g) => (
          <section key={g.versionId} aria-label={`Scores for ${g.label}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-brand-navy-900">Survey performance</h2>
                <p className="text-xs text-gray-500">Based on surveys counted in scores · {g.label}</p>
              </div>
              <p className="text-xs text-gray-600">
                {g.counted} counted · {g.withAlerts} with negative feedback
              </p>
            </div>
            {g.metrics.length === 0 ? (
              <p className={`${card} text-sm text-gray-500`}>This survey version has no scores defined.</p>
            ) : (
              <div className={`grid gap-4 md:grid-cols-2 ${g.metrics.length > 2 ? "xl:grid-cols-3" : ""}`}>
                {g.metrics.map((m, i) => {
                  const byBucket = new Map(g.trend.map((t) => [t.bucket, t.metrics[m.id] ?? null]));
                  const change = halfChange(g.trend.flatMap((t) => (typeof t.metrics[m.id] === "number" ? [{ value: t.metrics[m.id] as number, weight: t.counted }] : [])));
                  const show = (v: number | null) => (v === null ? "No score yet" : m.share ? `${Math.round(v * 100)}%` : score(v));
                  const down = change !== null && change.delta < 0;
                  const Icon = METRIC_ICONS[i % METRIC_ICONS.length];
                  return (
                    <div key={m.id} className={`${card} flex items-center gap-4`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="rounded-lg bg-indigo-50 p-1.5 text-indigo-600" aria-hidden="true">
                            <Icon className="size-4" />
                          </span>
                          <p className="text-sm font-medium text-gray-700">{m.label}</p>
                        </div>
                        <p className="mt-2 text-3xl font-semibold tabular-nums text-brand-navy-900">{show(m.average)}</p>
                        {change && (
                          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                            <span className={`rounded-md px-1.5 py-0.5 font-medium ${change.delta > 0 ? "bg-emerald-50 text-emerald-700" : down ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-600"}`}>
                              {change.delta > 0 ? "▲" : down ? "▼" : "■"} {m.share ? `${Math.abs(Math.round(change.delta * 100))} pts` : score(Math.abs(change.delta))}
                            </span>
                            <span className="text-gray-500">{change.delta === 0 ? "no change on" : "vs."} the first half of this period</span>
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-gray-500">
                          Average from {m.n} response{m.n === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="w-28 shrink-0 sm:w-44">
                        <TrendChart
                          id={`m-${g.versionId}-${m.id}`}
                          compact
                          height="h-16"
                          labels={labels}
                          valueLabel={(v) => show(v)}
                          series={[{ key: "avg", label: m.label, color: down ? C.negative : C.counted, area: true, values: buckets.map((b) => byBucket.get(b) ?? null) }]}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <DataTable
              caption={`Scores ${PER[summary.granularity]} for ${g.label}`}
              head={["Period", "Counted", ...g.metrics.map((m) => m.label)]}
              rows={g.trend.map((t) => [
                bucketLabel(t.bucket),
                t.counted,
                ...g.metrics.map((m) => {
                  const v = t.metrics[m.id] ?? null;
                  return v !== null && m.share ? `${Math.round(v * 100)}%` : score(v);
                }),
              ])}
            />
          </section>
        ))
      )}
      {summary.groups.length > 1 && (
        <section aria-labelledby="versions-heading" className={card}>
          <h2 id="versions-heading" className="text-base font-semibold text-brand-navy-900">
            Other survey versions in this view
          </h2>
          <p className="mt-1 text-xs text-gray-600">Each survey version is scored on its own. Versions are never averaged together, because their questions can differ.</p>
          <div className="relative mt-3 max-h-80 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-xs text-gray-500">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Version</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Counted</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Negative feedback</th>
                  <th scope="col" className="py-1.5 font-medium">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.groups.slice(1).map((g) => (
                  <tr key={g.versionId}>
                    <td className="py-1.5 pr-3 text-gray-800">{g.label}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{g.counted}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{g.withAlerts}</td>
                    <td className="py-1.5 text-right">
                      <Link href={href({ version: g.versionId })} className="text-sm font-medium text-indigo-600 hover:underline">
                        See scores<span className="sr-only"> for {g.label}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="list-heading" className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
        <div className="px-5 pt-5">
          <h2 id="list-heading" className="text-base font-semibold text-brand-navy-900">
            Responses
          </h2>
          <nav aria-label="Show responses" className="-mx-5 mt-3 overflow-x-auto px-5">
            <div className="flex min-w-max gap-1 border-b border-gray-200">
              {(Object.keys(LIST_VIEWS) as ListView[]).map((v) => (
                <Link
                  key={v}
                  href={`${href(v === "all" ? {} : { show: v })}#list-heading`}
                  aria-current={v === listView ? "true" : undefined}
                  className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${v === listView ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
                >
                  {LIST_VIEWS[v]}
                  <span className={`rounded-md px-1.5 text-xs tabular-nums ${v === listView ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-500"}`}>{viewCounts[v]}</span>
                </Link>
              ))}
            </div>
          </nav>
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-gray-50/80 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Received on</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Survey</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Source</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Negative feedback</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.total === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-left text-gray-500 sm:text-center">
                    No responses in this view.
                  </td>
                </tr>
              )}
              {list.items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/70">
                  <td className="whitespace-nowrap px-5 py-3">
                    <span className="font-medium text-brand-navy-900">{dayFormat.format(r.submittedAt)}</span> <span className="ml-1 text-xs text-gray-500">{timeFormat.format(r.submittedAt)}</span>
                    {r.corrected && <span className="ml-1 text-xs text-gray-500">(corrected)</span>}
                  </td>
                  <td className="max-w-72 truncate px-4 py-3 text-gray-700" title={r.versionLabel}>{r.versionLabel}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{SOURCE_LABELS[r.source]}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CATEGORY_STYLES[r.category]}`}>{CATEGORY_LABELS[r.category]}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.alerts.length === 0 ? (
                      <span className="text-gray-500">–</span>
                    ) : (
                      <span className="flex items-start gap-1.5 text-rose-700">
                        <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                        {r.alerts.join("; ")}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={responseHref(r.id)}
                      aria-label={`Open the response from ${dayFormat.format(r.submittedAt)} ${timeFormat.format(r.submittedAt)}`}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
                    >
                      View
                      <ChevronRight aria-hidden="true" className="size-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination {...list} path={action} query={{ ...filterQuery, ...(listView === "all" ? {} : { show: listView }) }} anchor="list-heading" label="Response list pages" />
        </div>
      </section>

      <section aria-labelledby="history-heading" className={card}>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-slate-100 p-1.5 text-slate-600" aria-hidden="true">
            <History className="size-4" />
          </span>
          <h2 id="history-heading" className="text-base font-semibold text-brand-navy-900">
            Earlier survey history (read-only)
          </h2>
        </div>
        {history.responses === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No earlier survey history is loaded for these dates.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-600">
              {history.responses} earlier responses from {history.sources.map((s) => HISTORY_SOURCES[s] ?? s).join(", ")}. Shown on their own scales; they are not mixed into the scores above.
            </p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {history.measures.map((m) => (
                <div key={`${m.key}-${m.scale}`} className="flex justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                  <dt className="text-gray-700">
                    {m.key} <span className="text-xs text-gray-500">(scale {m.scale})</span>
                  </dt>
                  <dd className="font-mono text-gray-900">
                    {score(m.average)} <span className="font-sans text-xs text-gray-500">n={m.n}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    </div>
  );
}

function Filter({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-gray-600">
        {label}
      </label>
      {children}
    </div>
  );
}

const STAT_TONES = {
  blue: { card: "bg-linear-to-br from-blue-50 to-white border-blue-100", icon: "bg-blue-100 text-blue-600" },
  green: { card: "bg-linear-to-br from-emerald-50 to-white border-emerald-100", icon: "bg-emerald-100 text-emerald-600" },
  amber: { card: "bg-linear-to-br from-amber-50 to-white border-amber-100", icon: "bg-amber-100 text-amber-600" },
  rose: { card: "bg-linear-to-br from-rose-50 to-white border-rose-100", icon: "bg-rose-100 text-rose-600" },
  slate: { card: "bg-white border-gray-200/80", icon: "bg-slate-100 text-slate-600" },
};

function Stat({ icon: Icon, tone, label, value, note }: { icon: LucideIcon; tone: keyof typeof STAT_TONES; label: string; value: number; note: string }) {
  const t = STAT_TONES[tone];
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${t.card}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        <span className={`rounded-lg p-1.5 ${t.icon}`} aria-hidden="true">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-navy-900">{value}</p>
      <p className="text-[11px] text-gray-500">{note}</p>
    </div>
  );
}

/** The numbers behind a chart, for screen readers and anyone who wants them (SR-39). */
function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-right text-xs font-medium text-indigo-600 hover:underline">Show as table →</summary>
      <div className="relative mt-2 max-h-64 overflow-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-white text-xs text-gray-500">
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="py-1 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={String(r[0])}>
                {r.map((cell, i) => (
                  <td key={i} className="py-1 pr-3 tabular-nums text-gray-800">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function exportQuery(shopId: string, filters: DashboardFilters) {
  return `/api/survey-results/export?shop=${shopId}&${filtersToQuery(filters)}`;
}
