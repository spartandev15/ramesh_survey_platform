import { AlertTriangle, CheckCircle2, Clock, Info, MoreHorizontal, Search, Store, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiveForm } from "@/components/live-form";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listSuppressions, suppressionStats } from "@/modules/cases/cases";
import { SUPPRESSION_RESULTS } from "@/modules/cases/store";
import { listVisibleShops } from "@/modules/shops/shops";
import { AckForm } from "./ack-form";

export const metadata: Metadata = { title: "Suppression queue" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const SELECT = "h-10 min-w-36 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-indigo-400";

/**
 * Routine-mail suppression changes to apply by hand in FileMaker until the
 * bridge exists (SR-36). An item is only "done" once someone acknowledges it.
 */
export default async function SuppressionPage({ searchParams }: PageProps<"/psg/suppression">) {
  const current = await pageRequireCapability("psg.workspace");
  const canAck = hasCapability(current.principal, "suppression.acknowledge");
  const query = await searchParams;
  const status = query.view === "acknowledged" ? "acknowledged" : "outstanding";
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const search = {
    q: one(query.q).trim().slice(0, 100) || undefined,
    desired: one(query.change) === "apply" || one(query.change) === "remove" ? (one(query.change) as "apply" | "remove") : undefined,
    shopId: one(query.shop) || undefined,
    sinceDays: [7, 30, 90].find((n) => String(n) === one(query.since)),
  };
  const [list, stats, shops] = await Promise.all([listSuppressions(status, pageNumber(query.page), search), suppressionStats(), listVisibleShops()]);
  const rows = list.items;
  const searching = Boolean(search.q || search.desired || search.shopId || search.sinceDays);
  const oldestDays = stats.oldest ? Math.max(0, Math.floor((new Date().getTime() - stats.oldest.getTime()) / 86_400_000)) : null;
  const base = Object.fromEntries(Object.entries(query).filter(([k, v]) => typeof v === "string" && v && k !== "page")) as Record<string, string>;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Suppression queue</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Changes to routine mail that must be made in FileMaker by hand. Being on this list does not mean it was done: acknowledge each change after you apply it. A later reversal appears as its own
          item.
        </p>
      </div>

      <nav aria-label="Suppression queues" className="flex gap-1 border-b border-gray-200">
        {(["outstanding", "acknowledged"] as const).map((s) => (
          <Link
            key={s}
            href={`/psg/suppression?view=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm ${s === status ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
          >
            {s === "outstanding" ? "Outstanding" : "Acknowledged"}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile icon={AlertTriangle} tone="bg-rose-50 text-rose-600" value={String(stats.outstanding)} label="Outstanding" note="Need applying in FileMaker" />
          <Tile icon={CheckCircle2} tone="bg-indigo-50 text-indigo-600" value={String(stats.acknowledged30)} label="Acknowledged" note="Last 30 days" />
          <Tile icon={Clock} tone="bg-amber-50 text-amber-600" value={oldestDays === null ? "None" : `${oldestDays} day${oldestDays === 1 ? "" : "s"}`} label="Oldest item" note={stats.oldest ? dateOnly.format(stats.oldest) : "Nothing waiting"} />
        </div>
        <LiveForm label="Find changes" className="flex flex-col gap-2 rounded-2xl border border-gray-200/80 bg-white p-3 shadow-sm">
          {Object.entries(base).map(([k, v]) => (["q", "change", "shop", "since"].includes(k) ? null : <input key={k} type="hidden" name={k} value={v} />))}
          <div className="relative">
            <label htmlFor="suppression-search" className="sr-only">
              Search changes
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
            <input
              id="suppression-search"
              name="q"
              type="search"
              defaultValue={search.q ?? ""}
              maxLength={100}
              autoComplete="off"
              placeholder="Search required change, shop or visit..."
              className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <label htmlFor="suppression-change" className="sr-only">
              Change type
            </label>
            <select id="suppression-change" name="change" defaultValue={search.desired ?? ""} className={SELECT}>
              <option value="">All change types</option>
              <option value="apply">Start suppressing</option>
              <option value="remove">Stop suppressing</option>
            </select>
            <label htmlFor="suppression-shop" className="sr-only">
              Shop
            </label>
            <select id="suppression-shop" name="shop" defaultValue={search.shopId ?? ""} className={SELECT}>
              <option value="">All shops</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label htmlFor="suppression-since" className="sr-only">
              Raised
            </label>
            <select id="suppression-since" name="since" defaultValue={search.sinceDays ? String(search.sinceDays) : ""} className={SELECT}>
              <option value="">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            {searching && (
              <Link href={`/psg/suppression?view=${status}`} className="flex h-10 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                Clear filters
              </Link>
            )}
            <noscript>
              <button type="submit" className="h-10 rounded-lg bg-brand-navy-900 px-3 text-sm text-white">
                Apply
              </button>
            </noscript>
          </div>
        </LiveForm>
      </div>

      <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Required change</th>
                <th scope="col" className="px-3 py-3 font-medium">Shop and visit</th>
                <th scope="col" className="px-3 py-3 font-medium">Raised</th>
                <th scope="col" className="px-3 py-3 font-medium">{status === "outstanding" ? "Acknowledge" : "Result"}</th>
                <th scope="col" className="px-3 py-3">
                  <span className="sr-only">More</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-left text-gray-500 sm:text-center">
                    {searching ? "No changes match these filters." : status === "outstanding" ? "Nothing to change in FileMaker right now." : "Nothing acknowledged yet."}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.action.id} className="align-top hover:bg-gray-50/60">
                  <td className="px-5 py-4">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${r.action.desired === "apply" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {r.action.desired === "apply" ? "Start suppressing" : "Stop suppressing"}
                    </span>
                    <span className="mt-1.5 block text-gray-900">{r.action.ruleLabel}</span>
                    {r.action.isTest && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-amber-800">
                        <Info aria-hidden="true" className="size-3.5" />
                        Test data: nothing to change in FileMaker
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex items-start gap-2.5">
                      <span className="rounded-lg bg-gray-100 p-1.5 text-gray-600" aria-hidden="true">
                        <Store className="size-4" />
                      </span>
                      <div className="min-w-0 text-gray-800">
                        {r.shopName ?? "Shop not confirmed"}
                        <span className="block font-mono text-xs text-gray-500">{r.visitKey ? `${r.sourceSystem}: ${r.visitKey}` : "visit not matched yet"}</span>
                        <Link href={`/psg/responses/${r.action.responseId}`} className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline">
                          Response
                        </Link>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-gray-700">
                    {dateTime.format(r.action.createdAt)}
                    <span className="block text-xs text-gray-500">from revision {r.action.sourceRevision}</span>
                  </td>
                  <td className="px-3 py-4">
                    {status === "outstanding" ? (
                      canAck ? (
                        <AckForm actionId={r.action.id} revision={r.action.revision} results={Object.entries(SUPPRESSION_RESULTS)} identified={Boolean(r.visitKey)} />
                      ) : (
                        <span className="text-xs text-gray-500">Waiting for an operator</span>
                      )
                    ) : (
                      <span className="text-xs text-gray-800">
                        {SUPPRESSION_RESULTS[r.action.result as keyof typeof SUPPRESSION_RESULTS] ?? r.action.result} by {r.ackName ?? "System"}
                        {r.action.acknowledgedAt ? `, ${dateTime.format(r.action.acknowledgedAt)}` : ""}
                        <span className="block text-gray-600">{r.action.evidence}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-4 text-right">
                    <details className="relative inline-block text-left">
                      <summary aria-label="More actions" className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
                        <MoreHorizontal aria-hidden="true" className="size-4" />
                      </summary>
                      <div className="absolute right-0 top-9 z-10 flex w-52 flex-col rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
                        <Link href={`/psg/responses/${r.action.responseId}`} className="px-4 py-2 text-gray-700 hover:bg-gray-50">
                          Open the response
                        </Link>
                        <Link href="/psg/operations?kind=suppression" className="px-4 py-2 text-gray-700 hover:bg-gray-50">
                          Owner and history
                        </Link>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination {...list} path="/psg/suppression" query={base} label="Suppression pages" />
        </div>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, tone, value, label, note }: { icon: LucideIcon; tone: string; value: string; label: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
      <span className={`rounded-full p-3 ${tone}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-semibold tabular-nums text-brand-navy-900">{value}</p>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="truncate text-xs text-gray-500">{note}</p>
      </div>
    </div>
  );
}
