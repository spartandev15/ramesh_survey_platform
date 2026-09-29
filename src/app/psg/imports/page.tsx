import type { Metadata } from "next";
import Link from "next/link";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listImports } from "@/modules/imports/imports";
import { SOURCE_SYSTEMS, type BatchCounts } from "@/modules/imports/store";
import { listVisibleShops } from "@/modules/shops/shops";
import { UploadForm } from "./upload-form";
import { ActionsHeader, RowActions } from "@/components/row-actions";

export const metadata: Metadata = { title: "Imports" };

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function summary(counts: BatchCounts | null) {
  if (!counts) return "Not committed";
  return `${counts.created} created · ${counts.reused} duplicate · ${counts.held} held · ${counts.excluded} excluded · ${counts.rejected} failed`;
}

export default async function ImportsPage({ searchParams }: PageProps<"/psg/imports">) {
  const current = await pageRequireCapability("psg.workspace");
  const canImport = hasCapability(current.principal, "import.manage");
  const query = await searchParams;
  const [list, shops] = await Promise.all([listImports(pageNumber(query.page)), listVisibleShops()]);
  const batches = list.items;

  return (
    <div className="grid max-w-6xl gap-8 lg:grid-cols-[1fr_320px]">
      <section className="min-w-0">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Imports</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Upload the customer records a shop sends. You see what each row will do before anything is created, and nothing is emailed from an upload.
        </p>
        <div className="relative mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Uploaded
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Shop
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  File
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Outcome
                </th>
                <ActionsHeader />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                    No imports yet.
                  </td>
                </tr>
              )}
              {batches.map(({ batch, shopName }) => (
                <tr key={batch.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{dateTime.format(batch.createdAt)}</td>
                  <td className="px-4 py-3 text-gray-900">{shopName}</td>
                  <td className="px-4 py-3">
                    <Link href={`/psg/imports/${batch.id}`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                      {batch.fileName}
                    </Link>
                    <span className="block text-xs text-gray-500">
                      {batch.kind === "visits" ? "Repair visits" : batch.kind === "legacy_cases" ? "Legacy cases" : "Legacy history"} · {batch.rowCount} rows
                      {batch.isTest ? " · Test data" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{batch.status === "preview" ? <span className="text-amber-800">Waiting for review</span> : summary(batch.counts as BatchCounts)}</td>
                  <td className="px-4 py-3">
                    <RowActions
                      actions={[
                        {
                          kind: "view",
                          label: "View",
                          href: `/psg/imports/${batch.id}`,
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...list} path="/psg/imports" query={query} label="Import pages" />
      </section>
      {canImport && (
        <section aria-labelledby="new-import" className="h-fit rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="new-import" className="text-base font-semibold text-brand-navy-900">
            New import
          </h2>
          <div className="mt-4">
            <UploadForm
              shops={shops.map((s) => ({
                id: s.id,
                name: s.name,
                isTestShop: s.isTestShop,
              }))}
              sourceSystems={Object.entries(SOURCE_SYSTEMS)}
            />
          </div>
        </section>
      )}
    </div>
  );
}
