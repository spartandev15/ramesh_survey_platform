import type { Metadata } from "next";
import Link from "next/link";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listInstruments } from "@/modules/instruments/instruments";
import { InstrumentForm } from "./instrument-form";
import { TestBadge } from "./version-badges";

export const metadata: Metadata = { title: "Surveys" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default async function InstrumentsPage() {
  const current = await pageRequireCapability("psg.workspace");
  const canManage = hasCapability(current.principal, "instrument.manage");
  const instruments = await listInstruments();

  return (
    <div className="grid max-w-7xl gap-8 xl:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-semibold text-brand-navy-900">Surveys</h1>
        <p className="mt-1 text-sm text-gray-500">
          Survey versions with their questions, scoring and alert rules. Published versions never change; edits create a new version.
        </p>

        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Survey</th>
                <th scope="col" className="px-4 py-3 font-medium">Latest published</th>
                <th scope="col" className="px-4 py-3 font-medium">Open draft</th>
                <th scope="col" className="px-4 py-3 font-medium">Versions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {instruments.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
