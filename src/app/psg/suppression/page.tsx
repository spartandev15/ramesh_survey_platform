import type { Metadata } from "next";
import Link from "next/link";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listSuppressions } from "@/modules/cases/cases";
import { SUPPRESSION_RESULTS } from "@/modules/cases/store";
import { AckForm } from "./ack-form";

export const metadata: Metadata = { title: "Suppression queue" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * Routine-mail suppression changes to apply by hand in FileMaker until the
 * bridge exists (SR-36). An item is only "done" once someone acknowledges it.
 */
export default async function SuppressionPage({ searchParams }: PageProps<"/psg/suppression">) {
  const current = await pageRequireCapability("psg.workspace");
  const canAck = hasCapability(current.principal, "suppression.acknowledge");
  const query = await searchParams;
  const view = query.view;
  const status = view === "acknowledged" ? "acknowledged" : "outstanding";
  const list = await listSuppressions(status, pageNumber(query.page));
  const rows = list.items;

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Suppression queue</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Changes to routine mail that must be made in FileMaker by hand. Being on this list does not mean it was done: acknowledge each change after you apply it. A later reversal appears as its own item.
      </p>
      <nav aria-label="Suppression queues" className="mt-6 flex gap-1 border-b border-gray-200">
        {(["outstanding", "acknowledged"] as const).map((s) => (
          <Link
            key={s}
            href={`/psg/suppression?view=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${s === status ? "border-brand-red font-medium text-brand-navy-900" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
          >
            {s === "outstanding" ? "Outstanding" : "Acknowledged"}
          </Link>
        ))}
      </nav>
      <div className="relative mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Required change</th>
              <th scope="col" className="px-3 py-2 font-medium">Shop and visit</th>
              <th scope="col" className="px-3 py-2 font-medium">Raised</th>
              <th scope="col" className="px-3 py-2 font-medium">{status === "outstanding" ? "Acknowledge" : "Result"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                  Nothing here.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.action.id} className="align-top">
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.action.desired === "apply" ? "bg-brand-red/10 text-brand-red-dark" : "bg-emerald-100 text-emerald-800"}`}>
                    {r.action.desired === "apply" ? "Start suppressing" : "Stop suppressing"}
                  </span>
                  <span className="mt-1 block text-gray-900">{r.action.ruleLabel}</span>
                  {r.action.isTest && <span className="text-xs text-amber-800">Test data: nothing to change in FileMaker</span>}
                </td>
                <td className="px-3 py-3 text-gray-800">
                  {r.shopName ?? "Shop not confirmed"}
                  <span className="block font-mono text-xs text-gray-500">{r.visitKey ? `${r.sourceSystem}: ${r.visitKey}` : "visit not matched yet"}</span>
                  <Link href={`/psg/responses/${r.action.responseId}`} className="text-xs text-brand-navy-900 underline-offset-2 hover:underline">
                    Response
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                  {dateTime.format(r.action.createdAt)}
                  <span className="block text-xs text-gray-500">from revision {r.action.sourceRevision}</span>
                </td>
                <td className="px-3 py-3">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...list} path="/psg/suppression" query={query} label="Suppression pages" />
    </div>
  );
}
