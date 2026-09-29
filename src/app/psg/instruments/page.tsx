import type { Metadata } from "next";
import Link from "next/link";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listInstruments } from "@/modules/instruments/instruments";
import { InstrumentForm } from "./instrument-form";
import { TestBadge } from "./version-badges";
import { ActionsHeader, RowActions } from "@/components/row-actions";

export const metadata: Metadata = { title: "Surveys" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default async function InstrumentsPage({ searchParams }: PageProps<"/psg/instruments">) {
  const current = await pageRequireCapability("psg.workspace");
  const canManage = hasCapability(current.principal, "instrument.manage");
  const [query, all] = await Promise.all([searchParams, listInstruments()]);
  const list = pageOf(all, pageNumber(query.page));
  const instruments = list.items;

  return (
    <div className="grid max-w-7xl gap-8 xl:grid-cols-[1fr_320px]">
      <section className="min-w-0">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Surveys</h1>
        <p className="mt-1 text-sm text-gray-500">Survey versions with their questions, scoring and alert rules. Published versions never change; edits create a new version.</p>

        <div className="relative mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Survey
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Latest published
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Open draft
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Versions
                </th>
                <ActionsHeader />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {instruments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                    No surveys yet. Run <code className="rounded bg-gray-100 px-1">npm run seed:demo</code> to load the demo survey.
                  </td>
                </tr>
              )}
              {instruments.map((i) => {
                const published = i.versions.find((v) => v.status === "published");
                const draft = i.versions.find((v) => v.status === "draft");
                return (
                  <tr key={i.id}>
                    <td className="px-4 py-3">
                      <Link href={`/psg/instruments/${i.id}`} className="font-medium text-brand-navy-900 hover:text-brand-red hover:underline">
                        {i.name}
                      </Link>
                      <p className="font-mono text-xs text-gray-500">{i.key}</p>
                      {i.shopId && <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">Shop questions: never scored</span>}
                    </td>
                    <td className="px-4 py-3">
                      {published ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-gray-900">v{published.version}</span>
                          <TestBadge isTest={published.isTest} />
                          {published.publishedAt && <span className="text-xs text-gray-500">{dateFormat.format(published.publishedAt)}</span>}
                        </div>
                      ) : (
                        <span className="text-gray-500">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{draft ? <span className="text-gray-900">v{draft.version}</span> : <span className="text-gray-500">None</span>}</td>
                    <td className="px-4 py-3 text-gray-600">{i.versions.length}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        actions={[
                          {
                            kind: "view",
                            label: "View",
                            href: `/psg/instruments/${i.id}`,
                          },
                          ...(draft
                            ? [
                                {
                                  kind: "edit" as const,
                                  label: "Edit draft",
                                  href: `/psg/instruments/${i.id}/edit`,
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination {...list} path="/psg/instruments" query={query} label="Survey pages" />
      </section>
      {canManage && (
        <section aria-labelledby="new-survey" className="h-fit rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="new-survey" className="text-base font-semibold text-brand-navy-900">
            New survey
          </h2>
          <p className="mt-1 text-sm text-gray-500">Starts as an empty draft you can build and preview.</p>
          <div className="mt-4">
            <InstrumentForm submitLabel="Create survey" />
          </div>
        </section>
      )}
    </div>
  );
}
