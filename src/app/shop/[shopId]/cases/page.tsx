import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireShopRead } from "@/modules/access/page-guards";
import { listShopCases } from "@/modules/cases/cases";

export const metadata: Metadata = { title: "Follow-up" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const FOLLOW_UP_LABELS: Record<string, { label: string; style: string }> = {
  open: { label: "Open", style: "bg-brand-red/10 text-brand-red-dark" },
  closure_requested: { label: "Closure requested", style: "bg-amber-100 text-amber-800" },
  resolved: { label: "Resolved", style: "bg-emerald-100 text-emerald-800" },
  none: { label: "Open", style: "bg-gray-100 text-gray-800" },
};

/** Negative feedback PSG has sent to the shop for follow-up (SR-34). */
export default async function ShopCasesPage({ params, searchParams }: PageProps<"/shop/[shopId]/cases">) {
  const { shopId } = await params;
  await pageRequireShopRead(shopId);
  const query = await searchParams;
  const list = await listShopCases(shopId, pageNumber(query.page));
  const rows = list.items;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Follow-up</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">Customer feedback PSG has asked you to follow up. Add what you did, then ask PSG to close it once the customer is taken care of.</p>
      <div tabIndex={0} className="relative mt-6 overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Sent to you</th>
              <th scope="col" className="px-3 py-2 font-medium">What needs attention</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                  Nothing needs follow-up.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const s = FOLLOW_UP_LABELS[r.case.followUp];
              return (
                <tr key={r.case.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link href={`/shop/${shopId}/cases/${r.case.id}`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                      {r.case.reviewedAt ? dateTime.format(r.case.reviewedAt) : dateTime.format(r.case.createdAt)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-red-800">{(r.case.alerts as { label: string }[]).map((a) => a.label).join("; ")}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.style}`}>{s.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination {...list} path={`/shop/${shopId}/cases`} query={query} label="Follow-up pages" />
    </div>
  );
}
