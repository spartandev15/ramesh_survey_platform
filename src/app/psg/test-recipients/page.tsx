import type { Metadata } from "next";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listTestAllowlist } from "@/modules/shops/settings";
import { AddEntryForm, RemoveEntryButton } from "./allowlist-editor";

export const metadata: Metadata = { title: "Test recipients" };

const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** Internal addresses that Test mode may email (SR-03). The dispatcher enforces it at send time. */
export default async function TestRecipientsPage({ searchParams }: PageProps<"/psg/test-recipients">) {
  const current = await pageRequireCapability("psg.workspace");
  const canManage = hasCapability(current.principal, "shop.manage");
  const [query, all] = await Promise.all([searchParams, listTestAllowlist()]);
  const list = pageOf(all, pageNumber(query.page));
  const entries = list.items;

  return (
    <div className="grid max-w-6xl gap-8 lg:grid-cols-[1fr_320px]">
      <section className="min-w-0">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Test recipients</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Shops in Test mode, and every test record, can email only these internal addresses. Any other address is refused when the email is sent, so a test can never reach a customer.
        </p>
        <div className="relative mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Address or domain</th>
                <th scope="col" className="px-4 py-3 font-medium">Note</th>
                <th scope="col" className="px-4 py-3 font-medium">Added</th>
                {canManage && (
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 4 : 3} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                    No test recipients yet. Test emails are refused until you add one.
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-900">{e.entry}</td>
                  <td className="px-4 py-3 text-gray-600">{e.note ?? ""}</td>
                  <td className="px-4 py-3 text-gray-600">{date.format(e.createdAt)}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <RemoveEntryButton id={e.id} entry={e.entry} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...list} path="/psg/test-recipients" query={query} label="Test recipient pages" />
      </section>
      {canManage && (
        <section aria-labelledby="add-entry" className="h-fit rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="add-entry" className="text-base font-semibold text-brand-navy-900">
            Add a test recipient
          </h2>
          <p className="mt-1 text-xs text-gray-500">Use a full address, or @domain to allow every address at that exact domain.</p>
          <div className="mt-4">
            <AddEntryForm />
          </div>
        </section>
      )}
    </div>
  );
}
