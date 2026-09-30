import { AlertTriangle, ClipboardList, Clock, Copy, Download, FileText, Globe, Link2, PenLine, Search, Store, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MiniBars } from "@/components/dashboard/charts";
import { LiveForm } from "@/components/live-form";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { responseStatus, SOURCE_LABELS } from "@/modules/responses/labels";
import { parseResponseQuery, PERIOD_OPTIONS, STATE_OPTIONS } from "@/modules/responses/list-query";
import { listResponses, matchQueueCounts, monthlyQueueCounts } from "@/modules/responses/staff";
import type { MatchStatus, RespondentContext } from "@/modules/responses/staff-store";
import { ActionsHeader, ICON_BUTTON, RowActions } from "@/components/row-actions";
import { ExportSelected, SelectAll } from "./selection";

export const metadata: Metadata = { title: "Responses" };

const PAGE_SIZES = [10, 20, 50] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SOURCE_ICONS: Record<string, LucideIcon> = { online: Link2, paper: PenLine, public: Globe };
const SOURCE_TONES: Record<string, string> = { online: "bg-indigo-50 text-indigo-600", paper: "bg-emerald-50 text-emerald-600", public: "bg-violet-50 text-violet-600" };
const AVATARS = ["bg-indigo-50 text-indigo-600", "bg-emerald-50 text-emerald-600", "bg-rose-50 text-rose-600", "bg-violet-50 text-violet-600", "bg-amber-50 text-amber-600", "bg-sky-50 text-sky-600"];
const avatar = (name: string) => AVATARS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATARS.length];
const SELECT = "h-10 min-w-36 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-indigo-400";
/** The same id as in ./selection: the row checkboxes submit with this form. */
const EXPORT_FORM = "export-selected";

const TABS: { key: MatchStatus | "all"; label: string; help: string }[] = [
  { key: "all", label: "All", help: "Every submitted response, newest first." },
  {
    key: "visit_unmatched",
    label: "Pending customer match",
    help: "The shop is known but not the visit. These show to the shop as pending and do not count in scores until matched.",
  },
  {
    key: "shop_unconfirmed",
    label: "Shop not confirmed",
    help: "PSG only. Confirm the shop from the evidence before anyone at a shop can see these.",
  },
  {
    key: "duplicate_review",
    label: "Duplicate review",
    help: "Another response already counts for the same visit. Decide which one counts.",
  },
];

export default async function ResponsesPage({ searchParams }: PageProps<"/psg/responses">) {
  const current = await pageRequireCapability("psg.workspace");
  const canEnterPaper = hasCapability(current.principal, "response.paper_entry");
  const query = await searchParams;
  const tab = TABS.find((t) => t.key === query.status) ?? TABS[0];
  const filters = parseResponseQuery(query);
  const per = PAGE_SIZES.find((n) => String(n) === query.per) ?? 10;
  const [list, counts, monthly, everything] = await Promise.all([listResponses(filters, pageNumber(query.page), per), matchQueueCounts(), monthlyQueueCounts(), listResponses({}, 1, 1)]);
  const rows = list.items;
  const dateTime = (d: Date, tz: string | null) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz ?? "America/New_York" }).format(d);

  // The address without the page, for links, the export and the forms' hidden fields.
  const base = Object.fromEntries(Object.entries(query).filter(([k, v]) => typeof v === "string" && v && k !== "page")) as Record<string, string>;
  const withParams = (path: string, next: Record<string, string | null>) => {
    const q = new URLSearchParams(base);
    q.delete("per");
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const filtered = Boolean(filters.q || filters.source || filters.sinceDays || filters.counted !== undefined);
  const monthLabels = monthly.map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (monthly.length - 1 - i), 1);
    return MONTHS[d.getMonth()];
  });

  const kpis: { label: string; value: number; values: number[]; tone: keyof typeof KPI_TONES; icon: LucideIcon; note: string; href?: string }[] = [
    { label: "Total responses", value: everything.total, values: monthly.map((m) => m.total), tone: "green", icon: ClipboardList, note: `${monthly.at(-1)?.total ?? 0} this month` },
    { label: "Pending customer match", value: counts.visit_unmatched ?? 0, values: monthly.map((m) => m.visit_unmatched), tone: "blue", icon: Clock, note: "Not in scores until matched", href: "/psg/responses?status=visit_unmatched" },
    { label: "Shop not confirmed", value: counts.shop_unconfirmed ?? 0, values: monthly.map((m) => m.shop_unconfirmed), tone: "red", icon: AlertTriangle, note: "Only PSG can see these", href: "/psg/responses?status=shop_unconfirmed" },
    { label: "Duplicate review", value: counts.duplicate_review ?? 0, values: monthly.map((m) => m.duplicate_review), tone: "purple", icon: Copy, note: "Decide which one counts", href: "/psg/responses?status=duplicate_review" },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Responses</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">Submitted surveys from every source. Each visit counts once; everything else is kept for review, never deleted.</p>
        </div>
        {canEnterPaper && (
          <Link href="/psg/responses/paper" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-red px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-red-dark">
            <FileText aria-hidden="true" className="size-4" />
            Enter paper survey
          </Link>
        )}
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => {
          const t = KPI_TONES[k.tone];
          const body = (
            <>
              <span className={`rounded-xl p-2.5 ${t.icon}`} aria-hidden="true">
                <k.icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-600">{k.label}</span>
                <span className="flex items-end justify-between gap-3">
                  <span className="text-2xl font-semibold tabular-nums text-brand-navy-900">{k.value.toLocaleString("en-US")}</span>
                  <span className="w-20 shrink-0">
                    <MiniBars labels={monthLabels} values={k.values} color={t.bar} />
                  </span>
                </span>
                <span className="mt-1 block text-xs text-gray-500">{k.note}</span>
              </span>
            </>
          );
          const cls = `flex items-start gap-3 rounded-2xl border p-5 shadow-sm ${t.card}`;
          return k.href ? (
            <Link key={k.label} href={k.href} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`}>
              {body}
            </Link>
          ) : (
            <div key={k.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>

      {/* Queues and export */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
        <nav aria-label="Response queues" className="-mb-px flex flex-wrap gap-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={withParams("/psg/responses", { status: t.key === "all" ? null : t.key })}
              aria-current={t.key === tab.key ? "page" : undefined}
              className={`border-b-2 px-3 py-2.5 text-sm ${t.key === tab.key ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
            >
              {t.label}
              {t.key === "all" ? <span className="text-gray-500"> ({everything.total})</span> : <span className="text-gray-500"> ({counts[t.key] ?? 0})</span>}
            </Link>
          ))}
        </nav>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ExportSelected />
          <a
            href={withParams("/psg/responses/export", {})}
            download
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-navy-900 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-navy-700"
          >
            <Download aria-hidden="true" className="size-4" />
            Export CSV{filtered || tab.key !== "all" ? ` (${list.total})` : ""}
          </a>
        </div>
      </div>
      {/* Where the ticked row checkboxes go; ?selected=1 so ticking none never exports everything. */}
      <form id={EXPORT_FORM} action="/psg/responses/export" method="get" className="hidden">
        <input type="hidden" name="selected" value="1" />
      </form>

      {/* Search and filters */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
        <LiveForm label="Find responses" className="flex flex-wrap items-end gap-2">
          {Object.entries(base).map(([k, v]) => (["q", "source", "state", "since"].includes(k) ? null : <input key={k} type="hidden" name={k} value={v} />))}
          <div className="relative min-w-48 flex-1">
            <label htmlFor="response-search" className="sr-only">
              Search responses
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
            <input
              id="response-search"
              name="q"
              type="search"
              defaultValue={filters.q ?? ""}
              maxLength={100}
              autoComplete="off"
              placeholder="Search by shop, visit ID, customer name or repair order..."
              className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white"
            />
          </div>
          <Field id="response-source" label="Source">
            <select id="response-source" name="source" defaultValue={filters.source ?? ""} className={SELECT}>
              <option value="">All sources</option>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field id="response-state" label="Counted">
            <select id="response-state" name="state" defaultValue={filters.counted === undefined ? "" : filters.counted ? "counted" : "not_counted"} className={SELECT}>
              <option value="">Any</option>
              {Object.entries(STATE_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field id="response-since" label="Date range">
            <select id="response-since" name="since" defaultValue={filters.sinceDays ? String(filters.sinceDays) : ""} className={SELECT}>
              <option value="">All time</option>
              {Object.entries(PERIOD_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <noscript>
            <button type="submit" className="h-10 rounded-lg bg-brand-navy-900 px-3 text-sm text-white">
              Apply
            </button>
          </noscript>
        </LiveForm>
        <p className="mt-3 text-xs text-gray-500">
          {tab.help}
          {filtered && (
            <>
              {" "}
              <span className="font-medium text-gray-700">
                {list.total} {list.total === 1 ? "response matches" : "responses match"} these filters.
              </span>{" "}
              <Link href={withParams("/psg/responses", { q: null, source: null, state: null, since: null })} className="text-indigo-600 hover:underline">
                Clear filters
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-gray-100 text-xs text-gray-500">
              <tr>
                <th scope="col" className="w-10 py-3 pl-5 pr-2">
                  <SelectAll />
                </th>
                <th scope="col" className="px-3 py-3 font-medium">Submitted</th>
                <th scope="col" className="px-3 py-3 font-medium">Shop</th>
                <th scope="col" className="px-3 py-3 font-medium">Source</th>
                <th scope="col" className="px-3 py-3 font-medium">Visit</th>
                <th scope="col" className="px-3 py-3 font-medium">Status</th>
                <ActionsHeader />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-left text-gray-500 sm:text-center">
                    {filtered ? "No responses match these filters." : "Nothing here."}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const s = responseStatus(r);
                const ctx = (r.context ?? {}) as RespondentContext;
                const when = r.submittedAt ? dateTime(r.submittedAt, r.shopTimezone) : "";
                const SourceIcon = SOURCE_ICONS[r.source] ?? Link2;
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="py-3 pl-5 pr-2">
                      <input type="checkbox" name="id" value={r.id} form={EXPORT_FORM} aria-label={`Select the response from ${when}`} className="size-4 rounded border-gray-300 accent-indigo-600" />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <Link href={`/psg/responses/${r.id}`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                        {when}
                      </Link>
                      {r.isTest && <span className="ml-1.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Test</span>}
                    </td>
                    <td className="px-3 py-3">
                      {r.shopName ? (
                        <div className="flex items-center gap-2.5">
                          <span className={`rounded-lg p-1.5 ${avatar(r.shopName)}`} aria-hidden="true">
                            <Store className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="whitespace-nowrap font-medium text-gray-900">{r.shopName}</p>
                            {r.shopTimezone && <p className="text-xs text-gray-500">{r.shopTimezone.replace("/", " / ").replace(/_/g, " ")}</p>}
                          </div>
                        </div>
                      ) : (
                        <span className="text-amber-800">
                          Not confirmed
                          {r.suggestions ? ` · ${r.suggestions} suggestion${r.suggestions === 1 ? "" : "s"}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-700">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-lg p-1.5 ${SOURCE_TONES[r.source] ?? "bg-gray-100 text-gray-600"}`} aria-hidden="true">
                          <SourceIcon className="size-3.5" />
                        </span>
                        <span>
                          {SOURCE_LABELS[r.source]}
                          {r.receivedOn && <span className="block text-xs text-gray-500">received {r.receivedOn}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-700">
                      {r.sourceVisitKey ?? (
                        <span className="font-sans text-gray-500">{r.source === "online" ? "PSG test link" : [ctx.name, ctx.repairOrder].filter(Boolean).join(" · ") || "Unknown"}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.style}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <RowActions actions={[{ kind: "view", label: "View", href: `/psg/responses/${r.id}`, title: "Answers, matching and corrections" }]} />
                        {/* A plain link: client-side navigation would try to render the CSV as a page. */}
                        <a href={`/psg/responses/export?id=${r.id}`} download title="Export this response (CSV)" className={`${ICON_BUTTON} border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900`}>
                          <Download aria-hidden="true" className="size-4" />
                          <span className="sr-only">Export the response from {when}</span>
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
          <LiveForm label="Page size" className="flex items-center gap-2">
            {Object.entries(base).map(([k, v]) => (k === "per" ? null : <input key={k} type="hidden" name={k} value={v} />))}
            <label htmlFor="responses-per-page" className="text-xs text-gray-500">
              Rows per page
            </label>
            <select id="responses-per-page" name="per" defaultValue={per === 10 ? "" : String(per)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800">
              <option value="">10 per page</option>
              <option value="20">20 per page</option>
              <option value="50">50 per page</option>
            </select>
          </LiveForm>
          <div className="min-w-0 flex-1">
            {list.pageCount <= 1 && list.total > 0 && (
              <p className="text-right text-sm text-gray-600">
                Showing all {list.total} response{list.total === 1 ? "" : "s"}
              </p>
            )}
            <Pagination {...list} path="/psg/responses" query={base} label="Response pages" />
          </div>
        </div>
      </div>
    </div>
  );
}

const KPI_TONES = {
  green: { card: "bg-linear-to-br from-emerald-50 to-white border-emerald-100", icon: "bg-emerald-100 text-emerald-600", bar: "#10b981" },
  blue: { card: "bg-linear-to-br from-blue-50 to-white border-blue-100", icon: "bg-blue-100 text-blue-600", bar: "#f59e0b" },
  red: { card: "bg-linear-to-br from-rose-50 to-white border-rose-100", icon: "bg-rose-100 text-rose-600", bar: "#f43f5e" },
  purple: { card: "bg-linear-to-br from-violet-50 to-white border-violet-100", icon: "bg-violet-100 text-violet-600", bar: "#8b5cf6" },
};

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-gray-500">
        {label}
      </label>
      {children}
    </div>
  );
}
