import { AlertTriangle, BarChart3, CheckCircle2, Clock, FileText, Info, MinusCircle, MoreVertical, Search, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Donut } from "@/components/dashboard/charts";
import { LiveForm } from "@/components/live-form";
import { Pagination } from "@/components/pagination";
import { Field } from "@/components/ui";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { alertReasonCounts, caseCounts, listCases } from "@/modules/cases/cases";
import type { CaseView } from "@/modules/cases/store";
import { listVisibleShops } from "@/modules/shops/shops";

export const metadata: Metadata = { title: "Alert review" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });
const SELECT = "h-10 min-w-36 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-indigo-400";

const TABS: { key: CaseView; label: string; help: string; icon: LucideIcon; tone: string; color: string }[] = [
  { key: "review", label: "Needs review", help: "Negative feedback waiting for PSG. No shop is emailed until you approve.", icon: AlertTriangle, tone: "bg-rose-50 text-rose-600 border-rose-100", color: "#f43f5e" },
  { key: "follow_up", label: "Follow-up open", help: "Approved and sent to the shop. The shop adds notes and asks to close when handled.", icon: Clock, tone: "bg-amber-50 text-amber-600 border-amber-100", color: "#f59e0b" },
  { key: "closure_requested", label: "Closure requested", help: "The shop says it is handled. Only PSG confirms the final resolution.", icon: FileText, tone: "bg-blue-50 text-blue-600 border-blue-100", color: "#3b82f6" },
  { key: "resolved", label: "Resolved", help: "Closed by PSG with a recorded outcome.", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600 border-emerald-100", color: "#10b981" },
  { key: "dismissed", label: "Dismissed", help: "Reviewed; PSG decided no shop outreach was needed.", icon: MinusCircle, tone: "bg-slate-50 text-slate-500 border-slate-200", color: "#94a3b8" },
];

export default async function AlertsPage({ searchParams }: PageProps<"/psg/alerts">) {
  await pageRequireCapability("psg.workspace");
  const query = await searchParams;
  const tab = TABS.find((t) => t.key === query.view) ?? TABS[0];
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const search = { q: one(query.q).trim().slice(0, 100) || undefined, shopId: one(query.shop) || undefined, newestFirst: one(query.sort) === "newest" };
  const [list, counts, reasons, shops] = await Promise.all([listCases(tab.key, pageNumber(query.page), search), caseCounts(), alertReasonCounts(tab.key), listVisibleShops()]);
  const rows = list.items;
  const total: Record<CaseView, number> = { review: counts.review, follow_up: counts.followUp, closure_requested: counts.closure, resolved: counts.resolved, dismissed: counts.dismissed };
  const all = Object.values(total).reduce((t, n) => t + n, 0);
  const topReason = Math.max(1, ...reasons.map((r) => r.n));
  const base = Object.fromEntries(Object.entries(query).filter(([k, v]) => typeof v === "string" && v && k !== "page")) as Record<string, string>;
  const searching = Boolean(search.q || search.shopId);
  const viewHref = (view: CaseView) => {
    const q = new URLSearchParams(base);
    q.set("view", view);
    return `/psg/alerts?${q}`;
  };

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Alert review</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">Negative feedback is reviewed here first. Shops see their results straight away, but they only get an alert email after PSG approves it.</p>
        </div>

        <nav aria-label="Alert queues" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={viewHref(t.key)}
                aria-current={t.key === tab.key ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${t.key === tab.key ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
              >
                {t.label} <span className="text-gray-500">({total[t.key]})</span>
              </Link>
            ))}
          </div>
        </nav>

        {/* One tile per queue; the open one is outlined. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={viewHref(t.key)}
              aria-hidden="true"
              tabIndex={-1}
              className={`flex items-center gap-3 rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 ${t.tone} ${t.key === tab.key ? "ring-2 ring-indigo-500/40" : ""}`}
            >
              <t.icon className="size-6 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xl font-semibold tabular-nums text-brand-navy-900">{total[t.key]}</span>
                <span className="block text-xs leading-tight text-gray-600">{t.label}</span>
              </span>
            </Link>
          ))}
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-4">
            <LiveForm label="Find alerts" className="flex flex-wrap items-end gap-2">
              {Object.entries(base).map(([k, v]) => (["q", "shop", "sort"].includes(k) ? null : <input key={k} type="hidden" name={k} value={v} />))}
              <div className="relative min-w-48 flex-1">
                <label htmlFor="alert-search" className="sr-only">
                  Search alerts
                </label>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
                <input
                  id="alert-search"
                  name="q"
                  type="search"
                  defaultValue={search.q ?? ""}
                  maxLength={100}
                  autoComplete="off"
                  placeholder="Search by shop name or alert reason..."
                  className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white"
                />
              </div>
              <Field id="alert-shop" label="Shop">
                <select id="alert-shop" name="shop" defaultValue={search.shopId ?? ""} className={SELECT}>
                  <option value="">All shops</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="alert-sort" label="Sort">
                <select id="alert-sort" name="sort" defaultValue={search.newestFirst ? "newest" : ""} className={SELECT}>
                  <option value="">Oldest first</option>
                  <option value="newest">Newest first</option>
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
              {searching && (
                <>
                  {" "}
                  <span className="font-medium text-gray-700">
                    {list.total} {list.total === 1 ? "alert matches" : "alerts match"}.
                  </span>{" "}
                  <Link href={`/psg/alerts?view=${tab.key}${base.sort ? `&sort=${base.sort}` : ""}`} className="text-indigo-600 hover:underline">
                    Clear search
                  </Link>
                </>
              )}
            </p>
          </div>
          <div tabIndex={0} className="relative overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Raised</th>
                  <th scope="col" className="px-3 py-3 font-medium">Shop</th>
                  <th scope="col" className="px-3 py-3 font-medium">What fired</th>
                  <th scope="col" className="px-3 py-3 font-medium">Notes</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-left text-gray-500 sm:text-center">
                      {searching ? "No alerts match this search." : "Nothing here."}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.case.id} className="hover:bg-gray-50/60">
                    <td className="whitespace-nowrap px-5 py-3">
                      <Link href={`/psg/alerts/${r.case.id}`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                        {dateFormat.format(r.case.createdAt)}
                      </Link>
                      <span className="block text-xs text-gray-500">{timeFormat.format(r.case.createdAt)}</span>
                      {r.case.isTest && <span className="mt-1 inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Test</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-800">{r.shopName ?? <span className="text-amber-800">Shop not confirmed</span>}</td>
                    <td className="px-3 py-3 text-xs text-rose-700">
                      {(r.case.alerts as { label: string }[]).map((a, i) => (
                        <span key={i} className="block">
                          {a.label}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600">
                      {r.case.outcomeChangedAt && <span className="block font-medium text-amber-800">Answers corrected after approval: review again</span>}
                      {r.matchStatus !== "matched" && <span className="block">Response {r.matchStatus === "visit_unmatched" ? "not matched to a visit yet" : r.matchStatus.replace("_", " ")}</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/psg/alerts/${r.case.id}`} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100">
                          Review
                        </Link>
                        <details className="relative">
                          <summary aria-label="More actions" className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                            <MoreVertical aria-hidden="true" className="size-4" />
                          </summary>
                          <div className="absolute right-0 top-9 z-10 flex w-52 flex-col rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
                            <Link href={`/psg/responses/${r.case.responseId}`} className="px-4 py-2 text-gray-700 hover:bg-gray-50">
                              Open the response
                            </Link>
                            {r.case.shopId && (
                              <Link href={`/psg/dashboard?shop=${r.case.shopId}`} className="px-4 py-2 text-gray-700 hover:bg-gray-50">
                                Shop dashboard
                              </Link>
                            )}
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 pb-4">
            <Pagination {...list} path="/psg/alerts" query={base} label="Alert pages" />
          </div>
        </div>
      </div>

      <aside aria-label="Alert summary" className="flex min-w-0 flex-col gap-4">
        <Panel icon={BarChart3} title="Review insights" subtitle="Every alert case, by where it stands.">
          <div className="flex items-center gap-4">
            <Donut total={all} caption="total" size="size-28" thickness={6} parts={TABS.map((t) => ({ label: t.label, value: total[t.key], color: t.color }))} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
              {TABS.map((t) => (
                <p key={t.key} className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-gray-600">{t.label}</span>
                  <span className="font-semibold tabular-nums text-brand-navy-900">{total[t.key]}</span>
                </p>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="Key alert reasons" subtitle={`What fired most in ${tab.label.toLowerCase()}.`}>
          {reasons.length === 0 ? (
            <p className="text-sm text-gray-500">No alerts in this queue.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {reasons.map((r) => (
                <div key={r.label}>
                  <p className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-gray-700">{r.label}</span>
                    <span className="font-semibold tabular-nums text-brand-navy-900">{r.n}</span>
                  </p>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    <span className="block h-full rounded-full bg-rose-500" style={{ width: `${(r.n / topReason) * 100}%` }} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel icon={Info} title="Next steps">
          <ol className="flex flex-col gap-3 text-xs text-gray-600">
            {[
              "Open each alert and read the customer's answers.",
              "Approve & Send to email the shop, or dismiss when no outreach is needed.",
              "Add notes as you go; only PSG confirms the final resolution.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-700">{i + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </aside>
    </div>
  );
}

function Panel({ icon: Icon, title, subtitle, children }: { icon?: LucideIcon; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        {Icon && (
          <span className="rounded-xl bg-indigo-50 p-2 text-indigo-600" aria-hidden="true">
            <Icon className="size-4" />
          </span>
        )}
        <div>
          <h2 className="text-sm font-semibold text-brand-navy-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
