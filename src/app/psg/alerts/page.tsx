import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { caseCounts, listCases } from "@/modules/cases/cases";
import type { CaseView } from "@/modules/cases/store";
import { ActionsHeader, RowActions } from "@/components/row-actions";

export const metadata: Metadata = { title: "Alert review" };

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const TABS: { key: CaseView; label: string; help: string }[] = [
  {
    key: "review",
    label: "Needs review",
    help: "Negative feedback waiting for PSG. No shop is emailed until you approve.",
  },
  {
    key: "follow_up",
    label: "Follow-up open",
    help: "Approved and sent to the shop. The shop adds notes and asks to close when handled.",
  },
  {
    key: "closure_requested",
    label: "Closure requested",
    help: "The shop says it is handled. Only PSG confirms the final resolution.",
  },
  {
    key: "resolved",
    label: "Resolved",
    help: "Closed by PSG with a recorded outcome.",
  },
  {
    key: "dismissed",
    label: "Dismissed",
    help: "Reviewed; PSG decided no shop outreach was needed.",
  },
];

export default async function AlertsPage({ searchParams }: PageProps<"/psg/alerts">) {
  await pageRequireCapability("psg.workspace");
  const query = await searchParams;
  const requested = query.view;
  const tab = TABS.find((t) => t.key === requested) ?? TABS[0];
  const [list, counts] = await Promise.all([listCases(tab.key, pageNumber(query.page)), caseCounts()]);
  const rows = list.items;
  const badge: Partial<Record<CaseView, number>> = {
    review: counts.review,
    follow_up: counts.followUp,
    closure_requested: counts.closure,
  };

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Alert review</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">Negative feedback is reviewed here first. Shops see their results straight away, but they only get an alert email after PSG approves it.</p>
      <nav aria-label="Alert queues" className="mt-6 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/psg/alerts?view=${t.key}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.key === tab.key ? "border-brand-red font-medium text-brand-navy-900" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
          >
            {t.label}
            {badge[t.key] !== undefined && <span className="text-gray-500"> ({badge[t.key]})</span>}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-sm text-gray-600">{tab.help}</p>
      <div className="relative mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Raised
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Shop
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                What fired
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Notes
              </th>
              <ActionsHeader />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                  Nothing here.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.case.id}>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/psg/alerts/${r.case.id}`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                    {dateTime.format(r.case.createdAt)}
                  </Link>
                  {r.case.isTest && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Test</span>}
                </td>
                <td className="px-3 py-2 text-gray-800">{r.shopName ?? <span className="text-amber-800">Shop not confirmed</span>}</td>
                <td className="px-3 py-2 text-xs text-red-800">{(r.case.alerts as { label: string }[]).map((a) => a.label).join("; ")}</td>
                <td className="px-3 py-2 text-xs text-gray-700">
                  {r.case.outcomeChangedAt && <span className="block font-medium text-amber-800">Answers corrected after approval: review again</span>}
                  {r.matchStatus !== "matched" && <span className="block">Response {r.matchStatus === "visit_unmatched" ? "not matched to a visit yet" : r.matchStatus.replace("_", " ")}</span>}
                </td>
                <td className="px-4 py-3">
                  <RowActions
                    actions={[
                      {
                        kind: "view",
                        label: "Review",
                        href: `/psg/alerts/${r.case.id}`,
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...list} path="/psg/alerts" query={query} label="Alert pages" />
    </div>
  );
}
