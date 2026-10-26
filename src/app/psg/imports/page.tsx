import { AlertCircle, Clock, Copy, FilePlus2, FileX2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiveForm } from "@/components/live-form";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { importTotals, listImports, listRejectedFiles } from "@/modules/imports/imports";
import { SOURCE_SYSTEMS, type BatchCounts } from "@/modules/imports/store";
import { listVisibleShops } from "@/modules/shops/shops";
import { UploadForm } from "./upload-form";
import { ActionsHeader, RowActions } from "@/components/row-actions";
import { Tile } from "@/components/ui";

export const metadata: Metadata = { title: "Imports" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeStyle: "short" });
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const KIND_NAMES: Record<string, string> = { visits: "Repair visits", legacy_ledger: "Legacy history", legacy_cases: "Legacy cases", opt_outs: "Opt-out list" };

export default async function ImportsPage({ searchParams }: PageProps<"/psg/imports">) {
  const current = await pageRequireCapability("psg.workspace");
  const canImport = hasCapability(current.principal, "import.manage");
  const query = await searchParams;
  const oldestFirst = query.sort === "oldest";
  const [list, shops, rejected, totals] = await Promise.all([listImports(pageNumber(query.page), oldestFirst), listVisibleShops(), listRejectedFiles(), importTotals()]);
  const batches = list.items;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Imports</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">Upload the customer records a shop sends. You see what each row will do before anything is created, and nothing is emailed from an upload.</p>
        </div>

        <p className="-mb-2 text-xs text-gray-500">Totals for production uploads; test uploads are listed below but not counted here.</p>
        <div data-tour="tiles" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Tile icon={FilePlus2} tone="bg-emerald-50 text-emerald-600" value={totals.created} label="Created" note="New customer records" />
          <Tile icon={Copy} tone="bg-blue-50 text-blue-600" value={totals.reused} label="Duplicate" note="Already on file" />
          <Tile icon={Clock} tone="bg-amber-50 text-amber-600" value={totals.held} label="Held" note="Waiting for details" />
          <Tile icon={AlertCircle} tone="bg-rose-50 text-rose-600" value={totals.excluded + totals.rejected} label="Excluded / failed" note="Not imported" />
        </div>

        <section aria-labelledby="history-heading" className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <h2 id="history-heading" className="text-lg font-semibold text-brand-navy-900">
              Import history <span className="text-gray-500">({list.total})</span>
            </h2>
            <LiveForm label="Import list order" className="flex items-center gap-2">
              <label htmlFor="imports-sort" className="sr-only">
                Order
              </label>
              <select id="imports-sort" name="sort" defaultValue={oldestFirst ? "oldest" : ""} className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800">
                <option value="">Most recent first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </LiveForm>
          </div>
          <div tabIndex={0} className="relative overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 border-t border-gray-100">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Uploaded</th>
                  <th scope="col" className="px-3 py-3 font-medium">Shop</th>
                  <th scope="col" className="px-3 py-3 font-medium">File</th>
                  <th scope="col" className="px-3 py-3 font-medium">Outcome</th>
                  <ActionsHeader />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batches.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-left text-gray-500 sm:text-center">
                      No imports yet.
                    </td>
                  </tr>
                )}
                {batches.map(({ batch, shopName }) => {
                  const counts = batch.counts as BatchCounts | null;
                  return (
                    <tr key={batch.id} className="hover:bg-gray-50/60">
                      <td className="whitespace-nowrap px-5 py-3 text-gray-700">
                        {dateFormat.format(batch.createdAt)}
                        <span className="block text-xs text-gray-500">{timeFormat.format(batch.createdAt)}</span>
                      </td>
                      <td className="px-3 py-3 text-gray-900">{shopName}</td>
                      <td className="px-3 py-3">
                        <Link href={`/psg/imports/${batch.id}`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                          {batch.fileName}
                        </Link>
                        <span className="block text-xs text-gray-500">
                          {KIND_NAMES[batch.kind]} · {batch.rowCount} rows
                          {batch.isTest ? " · Test data" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-700">
                        {batch.status === "preview" ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Waiting for review</span>
                        ) : !counts ? (
                          "Not committed"
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            <Count n={counts.created} label="created" tone="bg-emerald-50 text-emerald-700" />
                            <Count n={counts.reused} label="duplicate" tone="bg-blue-50 text-blue-700" />
                            <Count n={counts.held} label="held" tone="bg-amber-50 text-amber-800" />
                            <Count n={counts.excluded} label="excluded" tone="bg-gray-100 text-gray-700" />
                            <Count n={counts.rejected} label="failed" tone="bg-rose-50 text-rose-700" />
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RowActions actions={[{ kind: "view", label: "View", href: `/psg/imports/${batch.id}` }]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 pb-4">
            <Pagination {...list} path="/psg/imports" query={query} label="Import pages" />
          </div>
        </section>

        {rejected.length > 0 && (
          <section aria-labelledby="rejected-files" className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-rose-50 p-2.5 text-rose-600" aria-hidden="true">
                <FileX2 className="size-5" />
              </span>
              <div>
                <h2 id="rejected-files" className="text-base font-semibold text-brand-navy-900">
                  Files that could not be read
                </h2>
                <p className="text-xs text-gray-500">Nothing from these files was staged or sent. Fix the file and upload it again. The latest {rejected.length} are shown; all are kept in the audit history.</p>
              </div>
            </div>
            <ul className="mt-4 flex flex-col divide-y divide-gray-100 rounded-xl border border-gray-100">
              {rejected.map((r, i) => (
                <li key={i} className="px-4 py-3 text-sm">
                  <p className="font-medium text-gray-900">
                    {r.after.fileName}{" "}
                    <span className="font-normal text-gray-500">
                      · {r.shopName ?? "Unknown shop"}
                      {r.after.isTest ? " · Test data" : ""}
                    </span>
                  </p>
                  <p className="text-rose-700">{r.after.error}</p>
                  <p className="mt-0.5 break-all text-xs text-gray-500">
                    {dateTime.format(r.at)} · {r.actorName ?? "System"} · {Math.ceil(r.after.bytes / 1024)} KB · SHA-256 {r.after.sourceHash.slice(0, 12)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {canImport && (
        <section aria-labelledby="new-import" className="h-fit rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm lg:sticky lg:top-20">
          <h2 id="new-import" className="text-lg font-semibold text-brand-navy-900">
            New import
          </h2>
          <div className="mt-4">
            <UploadForm shops={shops.map((s) => ({ id: s.id, name: s.name, isTestShop: s.isTestShop }))} sourceSystems={Object.entries(SOURCE_SYSTEMS)} />
          </div>
        </section>
      )}
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 ${n === 0 ? "bg-gray-50 text-gray-500" : tone}`}>
      {n} {label}
    </span>
  );
}
