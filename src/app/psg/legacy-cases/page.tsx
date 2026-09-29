import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listLegacyCases } from "@/modules/legacy-cases/legacy-cases";
import { LEGACY_VIEW_LABELS, LEGACY_VIEWS, type LegacyView } from "@/modules/legacy-cases/store";
import { ActionsHeader, RowActions } from "@/components/row-actions";

export const metadata: Metadata = { title: "Legacy cases" };

const HELP: Record<LegacyView, string> = {
  with_legacy: "Open in the legacy system and still followed up there. Take one over only after its legacy owner stops, so the customer is never contacted by both.",
  in_hub: "Taken over from the legacy system: Hub alone follows these up now.",
  resolved: "Resolved in Hub, with the outcome PSG confirmed.",
  reference: "Already closed in the legacy system. Kept for reference; nothing to follow up.",
};

/** Legacy unresolved cases moving into Hub follow-up (SR-46). Import them from Imports as "Legacy follow-up cases". */
export default async function LegacyCasesPage({ searchParams }: PageProps<"/psg/legacy-cases">) {
  await pageRequireCapability("psg.workspace");
  const query = await searchParams;
  const requested = query.view;
  const view = LEGACY_VIEWS.includes(requested as LegacyView) ? (requested as LegacyView) : "with_legacy";
  const { list, counts } = await listLegacyCases(view, pageNumber(query.page));
  const rows = list.items;

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900">Legacy cases</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Follow-up cases from the legacy system. Repeated imports update a case until Hub takes it over and never create a second one. Compare these counts with the legacy system before and after a
            handoff.
          </p>
        </div>
        <Link href="/psg/imports" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:border-brand-navy-700">
          Import cases
        </Link>
      </div>

      <nav aria-label="Legacy case states" className="mt-6 flex flex-wrap gap-1 border-b border-gray-200">
        {LEGACY_VIEWS.map((v) => (
          <Link
            key={v}
            href={`/psg/legacy-cases?view=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${v === view ? "border-brand-red font-medium text-brand-navy-900" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
          >
            {LEGACY_VIEW_LABELS[v]} <span className="text-gray-500">({counts[v]})</span>
          </Link>
        ))}
      </nav>
      <p className="mt-3 max-w-3xl text-sm text-gray-600">{HELP[view]}</p>

      <div className="relative mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Case
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Shop
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Issue
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Opened
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Legacy owner
              </th>
              <ActionsHeader />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                  Nothing here.
                </td>
              </tr>
            )}
            {rows.map(({ c, shopName }) => (
              <tr key={c.id} className="align-top">
                <td className="px-3 py-2.5">
                  <Link href={`/psg/legacy-cases/${c.id}`} className="font-mono text-xs font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                    {c.sourceRef}
                  </Link>
                  {c.customerName && <span className="block text-xs text-gray-600">{c.customerName}</span>}
                </td>
                <td className="px-3 py-2.5 text-gray-800">{shopName}</td>
                <td className="max-w-80 px-3 py-2.5 text-gray-800">{c.summary ?? <span className="text-gray-500">Not given</span>}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-gray-700">{c.openedOn ?? "Unknown"}</td>
                <td className="px-3 py-2.5 text-gray-700">{c.legacyOwner ?? "Unknown"}</td>
                <td className="px-4 py-3">
                  <RowActions
                    actions={[
                      {
                        kind: "view",
                        label: "View",
                        href: `/psg/legacy-cases/${c.id}`,
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...list} path="/psg/legacy-cases" query={query} label="Legacy case pages" />
    </div>
  );
}
