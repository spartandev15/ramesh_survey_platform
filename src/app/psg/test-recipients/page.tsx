import { AtSign, Info, Mail, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
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
  const list = pageOf(all, pageNumber(query.page), 10);
  const entries = list.items;
  const columns = canManage ? 5 : 4;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex min-w-0 flex-col gap-5">
        <div>
          <Link href="/psg/shops" className="text-sm text-gray-500 hover:text-brand-navy-900">
            ← Back to Shops
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Test recipients</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Shops in Test mode, and every test record, can email only these internal addresses. Any other address is refused when the email is sent, so a test can never reach a customer.
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Address or domain</th>
                  <th scope="col" className="px-3 py-3 font-medium">Type</th>
                  <th scope="col" className="px-3 py-3 font-medium">Note</th>
                  <th scope="col" className="px-3 py-3 font-medium">Added</th>
                  {canManage && (
                    <th scope="col" className="px-5 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={columns} className="px-5 py-14 text-center">
                      <Mail aria-hidden="true" className="mx-auto mb-3 size-20 rounded-full bg-indigo-50 p-5 text-indigo-400" />
                      <p className="text-base font-semibold text-brand-navy-900">No test recipients yet</p>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">Test emails are refused until you add one. Add internal addresses or domains; any other address is refused, so a test can never reach a customer.</p>
                      {canManage && (
                        <a href="#entry" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                          <UserPlus aria-hidden="true" className="size-4" />
                          Add your first recipient
                        </a>
                      )}
                    </td>
                  </tr>
                )}
                {entries.map((e) => {
                  const domain = e.entry.startsWith("@");
                  return (
                    <tr key={e.id} className="hover:bg-gray-50/60">
                      <td className="px-5 py-3 font-mono text-xs text-gray-900">{e.entry}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${domain ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>
                          {domain ? <AtSign aria-hidden="true" className="size-3" /> : <Mail aria-hidden="true" className="size-3" />}
                          {domain ? "Whole domain" : "One address"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{e.note ?? ""}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{date.format(e.createdAt)}</td>
                      {canManage && (
                        <td className="px-5 py-3 text-right">
                          <RemoveEntryButton id={e.id} entry={e.entry} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 pb-4">
            <Pagination {...list} path="/psg/test-recipients" query={query} label="Test recipient pages" />
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-4">
        {canManage && (
          <section aria-labelledby="add-entry" className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600" aria-hidden="true">
                <UserPlus className="size-5" />
              </span>
              <div>
                <h2 id="add-entry" className="text-base font-semibold text-brand-navy-900">
                  Add a test recipient
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">Use a full address, or @domain to allow every address at that exact domain.</p>
              </div>
            </div>
            <div className="mt-4">
              <AddEntryForm />
            </div>
          </section>
        )}
        <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2.5 text-base font-semibold text-brand-navy-900">
            <Info aria-hidden="true" className="size-5 text-indigo-600" />
            About test recipients
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-600 marker:text-indigo-500">
            <li>Only the addresses on this list can receive emails from shops in Test mode and from test records.</li>
            <li>Add one address, or a whole domain with @domain (for example, @phoenixsolutionsgroup.net).</li>
            <li>Every other address is refused when the email is sent, so a test can never reach a customer.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
