import { AlertTriangle, CheckCircle2, Clock, Download, Inbox, PenLine, SlidersHorizontal, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { CATEGORY_LABELS, DATE_BASIS_LABELS, filtersToQuery, SOURCE_FILTER_LABELS, type Category, type DashboardFilters, type Granularity } from "@/modules/dashboard/cohort";
import { LIST_VIEWS, type getDashboard, type ListView } from "@/modules/dashboard/dashboard";
import { Donut, Gauge, Legend, SplitBar, TrendChart } from "./charts";

type Data = NonNullable<Awaited<ReturnType<typeof getDashboard>>>;

const SOURCE_LABELS: Record<string, string> = { online: "Online link", paper: "Paper", public: "Public form" };
const HISTORY_SOURCES: Record<string, string> = { supabase: "the previous survey system (Supabase)" };
const CATEGORY_STYLES: Record<Category, string> = {
  counted: "bg-teal-50 text-teal-800 ring-teal-600/20",
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

/** "Sep 7" for a day or week, "Sep 2026" for a month. */
function bucketLabel(bucket: string): string {
  const [y, m, d] = bucket.split("-").map(Number);
  return d ? `${MONTHS[m - 1]} ${d}` : `${MONTHS[m - 1]} ${y}`;
}
const score = (v: number | null) => (v === null ? "No score yet" : String(Number(v.toFixed(2))));

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
  responseHref,
  exportHref,
}: {
  data: Data;
  /** Where the filters submit (this page). */
  action: string;
  /** Extra fields to keep when filtering, e.g. the PSG shop picker. */
  hidden?: Record<string, string>;
  responseHref: (id: string) => string;
  exportHref: string;
}) {
  const { summary, filters, today, versionOptions, drafts, history, list, listView } = data;
  // The page says dates use the shop's local time, so the list does too.
  const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: data.shop.timezone, timeZoneName: "short" });
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

  return (
    <div className="flex flex-col gap-5">
      {/* Period, filters and export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Date range" className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {presets.map((p) => {
            const active = filters.from === p.from && filters.to === today;
            return (
              <Link
                key={p.label}
                href={href({ from: p.from, to: today })}
                aria-current={active ? "true" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-brand-navy-900 font-medium text-white shadow-sm" : "text-gray-600 hover:bg-gray-100 hover:text-brand-navy-900"}`}
              >
                {p.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-brand-navy-700 [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Filters
              {activeFilters > 0 && <span className="rounded-full bg-brand-navy-900 px-1.5 text-xs text-white">{activeFilters}</span>}
            </summary>
            <form action={action} className="absolute left-0 z-30 mt-2 flex w-[min(92vw,22rem)] sm:left-auto sm:right-0 flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
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
          <a href={exportHref} className="flex items-center gap-2 rounded-xl bg-brand-navy-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-navy-700">
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
        <Stat icon={Inbox} tone="text-indigo-600 bg-indigo-50" label="Submitted" value={summary.total} />
        <Stat icon={CheckCircle2} tone="text-teal-700 bg-teal-50" label="Counted in scores" value={counts.counted} emphasis />
        <Stat icon={Clock} tone="text-amber-700 bg-amber-50" label="Pending customer match" value={counts.pending_match} />
        <Stat icon={AlertTriangle} tone="text-rose-600 bg-rose-50" label="With negative feedback" value={summary.withAlerts} />
        <Stat icon={PenLine} tone="text-slate-600 bg-slate-100" label="Started, not submitted" value={drafts} note="All dates" />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-labelledby="volume-heading" className={`${card} lg:col-span-2`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="volume-heading" className="text-base font-semibold text-brand-navy-900">
              Responses over time <span className="text-sm font-normal text-gray-500">{PER[summary.granularity]}</span>
            </h2>
            <Legend
              items={[
                { label: "Submitted", color: C.total },
                { label: "Counted in scores", color: C.counted },
              ]}
            />
          </div>
          <div className="mt-4">
            <TrendChart
              id="volume"
              labels={labels}
              fromZero
              series={[
                { key: "total", label: "Submitted", color: C.total, area: true, values: summary.volume.map((v) => v.counted + v.other) },
                { key: "counted", label: "Counted", color: C.counted, values: summary.volume.map((v) => v.counted) },
              ]}
            />
          </div>
          <DataTable caption="Responses over time" head={["Period", "Submitted", "Counted"]} rows={summary.volume.filter((v) => v.counted + v.other > 0).map((v) => [bucketLabel(v.bucket), v.counted + v.other, v.counted])} />
        </section>

        <section aria-labelledby="mix-heading" className={card}>
          <h2 id="mix-heading" className="text-base font-semibold text-brand-navy-900">
            Where responses came from
          </h2>
          <div className="mt-4">
            <Donut
              total={summary.total}
              caption="submitted"
              parts={[
                { label: SOURCE_LABELS.online, value: summary.sources.online, color: C.total },
                { label: SOURCE_LABELS.paper, value: summary.sources.paper, color: C.paper },
                { label: SOURCE_LABELS.public, value: summary.sources.public, color: C.public },
              ]}
            />
          </div>
          <div className="mt-4 flex justify-center">
            <Legend
              items={[
                { label: SOURCE_LABELS.online, color: C.total, value: summary.sources.online },
                { label: SOURCE_LABELS.paper, color: C.paper, value: summary.sources.paper },
                { label: SOURCE_LABELS.public, color: C.public, value: summary.sources.public },
              ]}
            />
          </div>
          <h3 className="mt-6 text-sm font-semibold text-brand-navy-900">What counts in the scores</h3>
          <div className="mt-2">
            <SplitBar
              parts={[
                { label: "Counted", value: counts.counted, color: C.counted },
                { label: "Pending match", value: counts.pending_match, color: C.pending },
                { label: "Not counted", value: notCounted, color: C.other },
              ]}
            />
          </div>
          <div className="mt-2">
            <Legend
              items={[
                { label: "Counted", color: C.counted, value: counts.counted },
                { label: "Pending match", color: C.pending, value: counts.pending_match },
                { label: "Not counted", color: C.other, value: notCounted },
              ]}
            />
          </div>
          <p className="mt-3 text-xs text-gray-600">
            {excluded.length === 0 ? "Every submitted response in this view counts in the scores." : `Not in the scores: ${excluded.map(([what, n]) => `${n} ${what}`).join(", ")}. Drafts never count.`}
          </p>
        </section>
      </div>

      {summary.groups.length === 0 ? (
        <p className={`${card} text-center text-sm text-gray-500`}>No counted responses in this view yet.</p>
      ) : (
        summary.groups.slice(0, 1).map((g) => (
          <section key={g.versionId} aria-label={`Scores for ${g.label}`} className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-brand-navy-900">{g.label}</h2>
              <p className="text-sm text-gray-600">
                {g.counted} counted · {g.withAlerts} with negative feedback
              </p>
            </div>
            {g.metrics.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">This survey version has no scores defined.</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.metrics.map((m) => {
                  const byBucket = new Map(g.trend.map((t) => [t.bucket, t.metrics[m.id] ?? null]));
                  const change = halfChange(g.trend.flatMap((t) => (typeof t.metrics[m.id] === "number" ? [{ value: t.metrics[m.id] as number, weight: t.counted }] : [])));
                  const show = (v: number | null) => (v === null ? "No score yet" : m.share ? `${Math.round(v * 100)}%` : score(v));
                  const color = change && change.delta < 0 ? C.negative : C.counted;
                  return (
                    <div key={m.id} className="rounded-xl border border-gray-100 bg-gradient-to-b from-slate-50 to-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-600">{m.label}</p>
                          <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-navy-900">{show(m.average)}</p>
                          <p className="text-xs text-gray-500">
                            Average from {m.n} response{m.n === 1 ? "" : "s"}
                          </p>
                        </div>
                        {m.share && m.average !== null && <Gauge value={m.average} color={C.counted} />}
                      </div>
                      {change && (
                        <p className={`mt-2 text-xs font-medium ${change.delta > 0 ? "text-teal-700" : change.delta < 0 ? "text-rose-700" : "text-gray-600"}`}>
                          {change.delta > 0 ? "▲" : change.delta < 0 ? "▼" : "■"} {m.share ? `${Math.abs(Math.round(change.delta * 100))} points` : score(Math.abs(change.delta))}{" "}
                          {change.delta === 0 ? "no change" : change.delta > 0 ? "up" : "down"} on the first half of this period
                        </p>
                      )}
                      <div className="mt-3">
                        <TrendChart
                          id={`m-${g.versionId}-${m.id}`}
                          compact
                          height="h-14"
                          labels={labels}
                          valueLabel={(v) => show(v)}
                          series={[{ key: "avg", label: m.label, color, area: true, values: buckets.map((b) => byBucket.get(b) ?? null) }]}
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
              rows={g.trend.map((t) => [bucketLabel(t.bucket), t.counted, ...g.metrics.map((m) => { const v = t.metrics[m.id] ?? null; return v !== null && m.share ? `${Math.round(v * 100)}%` : score(v); })])}
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
                      <Link href={href({ version: g.versionId })} className="text-sm font-medium text-brand-navy-900 hover:underline">
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

      <section aria-labelledby="history-heading" className={card}>
        <h2 id="history-heading" className="text-base font-semibold text-brand-navy-900">
          Earlier survey history (read-only)
        </h2>
        {history.responses === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No earlier survey history is loaded for these dates.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600">
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

      <section aria-labelledby="list-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="list-heading" className="text-base font-semibold text-brand-navy-900">
            Responses
          </h2>
          <nav aria-label="Show responses" className="flex flex-wrap gap-1.5">
            {(Object.keys(LIST_VIEWS) as ListView[]).map((v) => (
              <Link
                key={v}
                href={`${href(v === "all" ? {} : { show: v })}#list-heading`}
                aria-current={v === listView ? "true" : undefined}
                className={`rounded-full px-3 py-1 text-xs ring-1 transition ${v === listView ? "bg-brand-navy-900 font-medium text-white ring-brand-navy-900" : "bg-white text-gray-700 ring-gray-200 hover:ring-brand-navy-700"}`}
              >
                {LIST_VIEWS[v]} <span className={v === listView ? "text-white/80" : "text-gray-500"}>{viewCounts[v]}</span>
              </Link>
            ))}
          </nav>
        </div>
        <div className="relative mt-3 overflow-x-auto rounded-2xl border border-gray-200/80 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Submitted</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Source</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Negative feedback</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.total === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                    No responses in this view.
                  </td>
                </tr>
              )}
              {list.items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/70">
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Link href={responseHref(r.id)} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                      {dateTime.format(r.submittedAt)}
                    </Link>
                    {r.corrected && <span className="ml-1 text-xs text-gray-500">(corrected)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{SOURCE_LABELS[r.source]}</td>
                  <td className="px-4 py-2.5">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CATEGORY_STYLES[r.category]}`}>{CATEGORY_LABELS[r.category]}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-rose-700">{r.alerts.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...list} path={action} query={{ ...filterQuery, ...(listView === "all" ? {} : { show: listView }) }} anchor="list-heading" label="Response list pages" />
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

function Stat({ icon: Icon, tone, label, value, emphasis, note }: { icon: LucideIcon; tone: string; label: string; value: number; emphasis?: boolean; note?: string }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${emphasis ? "border-teal-600/40 ring-1 ring-teal-600/20" : "border-gray-200/80"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <span className={`rounded-lg p-1.5 ${tone}`} aria-hidden="true">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-navy-900">{value}</p>
      {note && <p className="text-xs text-gray-500">{note}</p>}
    </div>
  );
}

/** The numbers behind a chart, for screen readers and anyone who wants them (SR-39). */
function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return null;
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-brand-navy-900">Show as table</summary>
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
