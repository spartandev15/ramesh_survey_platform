import { ClipboardList, FilePen, FilePlus2, FlaskConical, PlayCircle, Search, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Sparkline } from "@/components/dashboard/charts";
import { LiveForm } from "@/components/live-form";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listInstruments } from "@/modules/instruments/instruments";
import { filterSurveys, latestPublished, parseSurveyFilters, SURVEY_SORTS, SURVEY_STATUSES, SURVEY_TYPES, surveyStatus, type SurveyStatus } from "@/modules/instruments/list-filter";
import { InstrumentForm } from "./instrument-form";
import { ActionsHeader, RowActions } from "@/components/row-actions";
import { Field, Kpi } from "@/components/ui";

export const metadata: Metadata = { title: "Surveys" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const PAGE_SIZES = [10, 20, 50] as const;
const DAY = 86_400_000;
const STATUS_STYLE: Record<SurveyStatus, string> = {
  published: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  draft: "bg-sky-50 text-sky-700 ring-sky-600/20",
  test: "bg-amber-50 text-amber-800 ring-amber-600/20",
};
const AVATARS = ["bg-indigo-50 text-indigo-600", "bg-emerald-50 text-emerald-600", "bg-rose-50 text-rose-600", "bg-violet-50 text-violet-600", "bg-amber-50 text-amber-600", "bg-sky-50 text-sky-600"];
const avatar = (name: string) => AVATARS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATARS.length];
const SELECT = "h-10 min-w-36 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-indigo-400";

export default async function InstrumentsPage({ searchParams }: PageProps<"/psg/instruments">) {
  const current = await pageRequireCapability("psg.workspace");
  const canManage = hasCapability(current.principal, "instrument.manage");
  const [query, all] = await Promise.all([searchParams, listInstruments()]);
  const filters = parseSurveyFilters(query);
  const per = PAGE_SIZES.find((n) => String(n) === query.per) ?? 10;
  const list = pageOf(filterSurveys(all, filters), pageNumber(query.page), per);
  const instruments = list.items;
  const searching = filters.q !== "" || filters.status !== "all" || filters.type !== "all";
  const now = new Date().getTime();

  // Headline numbers, over every survey.
  const statusOf = new Map(all.map((i) => [i.id, surveyStatus(i)]));
  const count = (s: SurveyStatus) => all.filter((i) => statusOf.get(i.id) === s).length;
  const withDraft = all.filter((i) => i.versions.some((v) => v.status === "draft")).length;
  // How many existed (or were published) at the end of each of the last 12 months.
  const monthEnds = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (11 - i) + 1, 1);
    return d.getTime();
  });
  const created = monthEnds.map((end) => all.filter((i) => i.createdAt.getTime() < end).length);
  const publishedBy = monthEnds.map((end) => all.filter((i) => i.versions.some((v) => v.publishedAt && v.publishedAt.getTime() < end)).length);
  const lately = (dates: (Date | null)[]) => dates.filter((d) => d && now - d.getTime() < 30 * DAY).length;

  const link = (next: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (typeof v === "string" && v && k !== "page" && !(k in next)) q.set(k, v);
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/psg/instruments?${s}` : "/psg/instruments";
  };
  const listQuery = Object.fromEntries(Object.entries(query).filter(([k, v]) => typeof v === "string" && v && k !== "page")) as Record<string, string>;
  const chips: { label: string; count: number; status: string }[] = [
    { label: "All", count: all.length, status: "" },
    { label: "Published", count: count("published"), status: "published" },
    { label: "Draft", count: count("draft"), status: "draft" },
    { label: "Test only", count: count("test"), status: "test" },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Surveys</h1>
        <p className="mt-1 text-sm text-gray-600">Survey versions with their questions, scoring and alert rules. Published versions never change; edits create a new version.</p>
      </div>

      {/* Headline numbers */}
      <div data-tour="tiles" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="blue" icon={ClipboardList} label="Total surveys" value={all.length} note={`${lately(all.map((i) => i.createdAt))} created in the last 30 days`}>
          <Sparkline id="surveys-total" values={created} color="#4f7cf7" label="Surveys, month by month" className="h-10 w-24" />
        </Kpi>
        <Kpi tone="green" icon={PlayCircle} label="Published surveys" value={count("published")} note="Verified and ready for Live shops">
          <Sparkline id="surveys-published" values={publishedBy} color="#10b981" label="Surveys with a published version, month by month" className="h-10 w-24" />
        </Kpi>
        <Kpi tone="amber" icon={FilePen} label="Draft surveys" value={count("draft")} note={`${withDraft} survey${withDraft === 1 ? " has" : "s have"} an open draft`} />
        <Kpi tone="rose" icon={FlaskConical} label="Test only surveys" value={count("test")} note="Never used for Live customers" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Search, filters and quick filters */}
          <div className="flex flex-col gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
            <LiveForm label="Find surveys" className="flex flex-wrap items-end gap-2">
              {Object.entries(listQuery).map(([k, v]) => (["q", "status", "type", "sort"].includes(k) ? null : <input key={k} type="hidden" name={k} value={v} />))}
              <div className="relative min-w-48 flex-1">
                <label htmlFor="survey-search" className="sr-only">
                  Search surveys
                </label>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
                <input
                  id="survey-search"
                  name="q"
                  type="search"
                  defaultValue={filters.q}
                  maxLength={100}
                  autoComplete="off"
                  placeholder="Search by survey name, key or description..."
                  className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white"
                />
              </div>
              <Field id="survey-status" label="Status">
                <select id="survey-status" name="status" defaultValue={filters.status === "all" ? "" : filters.status} className={SELECT}>
                  {Object.entries(SURVEY_STATUSES).map(([k, v]) => (
                    <option key={k} value={k === "all" ? "" : k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="survey-type" label="Type">
                <select id="survey-type" name="type" defaultValue={filters.type === "all" ? "" : filters.type} className={SELECT}>
                  {Object.entries(SURVEY_TYPES).map(([k, v]) => (
                    <option key={k} value={k === "all" ? "" : k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="survey-sort" label="Sort by">
                <select id="survey-sort" name="sort" defaultValue={filters.sort === "published" ? "" : filters.sort} className={SELECT}>
                  {Object.entries(SURVEY_SORTS).map(([k, v]) => (
                    <option key={k} value={k === "published" ? "" : k}>
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
            <nav aria-label="Quick filters" className="flex flex-wrap items-center gap-2">
              {chips.map((c) => {
                const active = (filters.status === "all" ? "" : filters.status) === c.status;
                return (
                  <Link
                    key={c.label}
                    href={link({ status: c.status })}
                    aria-current={active ? "true" : undefined}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${active ? "bg-indigo-600 text-white" : "bg-gray-50 text-gray-700 ring-1 ring-gray-200 hover:ring-gray-400"}`}
                  >
                    {c.label} ({c.count})
                  </Link>
                );
              })}
              {searching && (
                <Link href="/psg/instruments" className="ml-auto text-xs text-indigo-600 hover:underline">
                  Clear filters
                </Link>
              )}
            </nav>
          </div>

          <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-gray-100 text-xs text-gray-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Survey</th>
                    <th scope="col" className="px-4 py-3 font-medium">Latest published</th>
                    <th scope="col" className="px-4 py-3 font-medium">Open draft</th>
                    <th scope="col" className="px-4 py-3 font-medium">Versions</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <ActionsHeader />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {instruments.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-left text-gray-500 sm:text-center">
                        {searching ? (
                          "No surveys match these filters."
                        ) : (
                          <>
                            No surveys yet. Run <code className="rounded bg-gray-100 px-1">npm run seed:demo</code> to load the demo survey.
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                  {instruments.map((i) => {
                    const published = latestPublished(i.versions);
                    const draft = i.versions.find((v) => v.status === "draft");
                    const status = statusOf.get(i.id) ?? "draft";
                    return (
                      <tr key={i.id} className="hover:bg-gray-50/60">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <span className={`rounded-lg p-2 ${avatar(i.name)}`} aria-hidden="true">
                              {i.shopId ? <Store className="size-4" /> : <ClipboardList className="size-4" />}
                            </span>
                            <div className="min-w-0">
                              <Link href={`/psg/instruments/${i.id}`} className="font-semibold text-brand-navy-900 hover:text-indigo-700 hover:underline">
                                {i.name}
                              </Link>
                              <p className="font-mono text-xs text-gray-500">{i.key}</p>
                              {i.shopId && <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">Shop questions: never scored</span>}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {published ? (
                            <>
                              <span className="font-semibold text-gray-900">v{published.version}</span>{" "}
                              {published.publishedAt && <span className="text-xs text-gray-500">{dateFormat.format(published.publishedAt)}</span>}
                            </>
                          ) : (
                            <span className="text-gray-500">None</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {draft ? (
                            <>
                              <span className="text-gray-900">v{draft.version} (draft)</span>
                              <p className="text-xs text-gray-500">{dateFormat.format(draft.updatedAt)}</p>
                            </>
                          ) : (
                            <span className="text-gray-500">None</span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-gray-700">{i.versions.length}</td>
                        <td className="px-4 py-3">
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>{SURVEY_STATUSES[status]}</span>
                        </td>
                        <td className="px-4 py-3">
                          <RowActions
                            actions={[
                              { kind: "view", label: "View", href: `/psg/instruments/${i.id}` },
                              ...(draft ? [{ kind: "edit" as const, label: "Edit draft", href: `/psg/instruments/${i.id}/edit` }] : []),
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
              <LiveForm label="Page size" className="flex items-center gap-2">
                {Object.entries(listQuery).map(([k, v]) => (k === "per" ? null : <input key={k} type="hidden" name={k} value={v} />))}
                <label htmlFor="surveys-per-page" className="text-xs text-gray-500">
                  Rows per page
                </label>
                <select id="surveys-per-page" name="per" defaultValue={per === 10 ? "" : String(per)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800">
                  <option value="">10 per page</option>
                  <option value="20">20 per page</option>
                  <option value="50">50 per page</option>
                </select>
              </LiveForm>
              <div className="min-w-0 flex-1">
                {list.pageCount <= 1 && list.total > 0 && (
                  <p className="text-right text-sm text-gray-600">
                    Showing all {list.total} survey{list.total === 1 ? "" : "s"}
                  </p>
                )}
                <Pagination {...list} path="/psg/instruments" query={listQuery} label="Survey pages" />
              </div>
            </div>
          </div>
        </div>

        {canManage && (
          <section aria-labelledby="new-survey" className="h-fit rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600" aria-hidden="true">
                <FilePlus2 className="size-5" />
              </span>
              <div>
                <h2 id="new-survey" className="text-base font-semibold text-brand-navy-900">
                  Create new survey
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">Starts as an empty draft. Add questions, scoring and alert rules next, then preview and publish.</p>
              </div>
            </div>
            <div className="mt-5">
              <InstrumentForm submitLabel="Create survey" />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
