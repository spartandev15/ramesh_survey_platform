import type { Metadata } from "next";
import Link from "next/link";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listResponses, matchQueueCounts } from "@/modules/responses/staff";
import type { MatchStatus, RespondentContext } from "@/modules/responses/staff-store";
import { responseStatus, SOURCE_LABELS } from "./labels";
import { ActionsHeader, RowActions } from "@/components/row-actions";

export const metadata: Metadata = { title: "Responses" };

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

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
  const requested = query.status;
  const tab = TABS.find((t) => t.key === requested) ?? TABS[0];
  const [list, counts] = await Promise.all([listResponses({ matchStatus: tab.key === "all" ? undefined : tab.key }, pageNumber(query.page)), matchQueueCounts()]);
  const rows = list.items;

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900">Responses</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">Submitted surveys from every source. Each visit counts once; everything else is kept for review, never deleted.</p>
        </div>
        {canEnterPaper && (
          <Link href="/psg/responses/paper" className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark">
            Enter paper survey
          </Link>
        )}
      </div>

      <nav aria-label="Response queues" className="mt-6 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/psg/responses" : `/psg/responses?status=${t.key}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.key === tab.key ? "border-brand-red font-medium text-brand-navy-900" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
          >
            {t.label}
            {t.key !== "all" && <span className="text-gray-500"> ({counts[t.key] ?? 0})</span>}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-sm text-gray-600">{tab.help}</p>

      <div className="relative mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Submitted
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Shop
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Source
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Visit
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
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
            {rows.map((r) => {
              const s = responseStatus(r);
              const ctx = (r.context ?? {}) as RespondentContext;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link href={`/psg/responses/${r.id}`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                      {r.submittedAt ? dateTime.format(r.submittedAt) : ""}
                    </Link>
                    {r.isTest && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Test</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-800">
                    {r.shopName ?? (
                      <span className="text-amber-800">
                        Not confirmed
                        {r.suggestions ? ` · ${r.suggestions} suggestion${r.suggestions === 1 ? "" : "s"}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {SOURCE_LABELS[r.source]}
                    {r.receivedOn && <span className="block text-xs text-gray-500">received {r.receivedOn}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">
                    {r.sourceVisitKey ?? (
                      <span className="font-sans text-gray-500">{r.source === "online" ? "PSG test link" : [ctx.name, ctx.repairOrder].filter(Boolean).join(" · ") || "Unknown"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.style}`}>{s.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      actions={[
                        {
                          kind: "view",
                          label: "View",
                          href: `/psg/responses/${r.id}`,
                          title: "Answers, matching and corrections",
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination {...list} path="/psg/responses" query={query} label="Response pages" />
    </div>
  );
}
