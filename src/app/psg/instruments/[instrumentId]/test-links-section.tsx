import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { listVisibleShops } from "@/modules/shops/shops";
import { listTestLinks } from "@/modules/responses/test-links";
import { TestLinkForm } from "./test-link-form";

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const STATUS: Record<"not_started" | "draft" | "submitted", { label: string; className: string }> = {
  not_started: { label: "Not started", className: "bg-gray-100 text-gray-700" },
  draft: { label: "In progress", className: "bg-sky-100 text-sky-800" },
  submitted: { label: "Submitted", className: "bg-emerald-100 text-emerald-800" },
};

/** Internal test links for one published version, with what each test response produced. */
export async function TestLinksSection({
  instrumentId,
  versionId,
  canManage,
  ownerShopId,
  query,
}: {
  instrumentId: string;
  versionId: string;
  canManage: boolean;
  ownerShopId: string | null;
  query: Record<string, string | string[] | undefined>;
}) {
  const [all, allShops] = await Promise.all([listTestLinks(versionId), canManage ? listVisibleShops() : Promise.resolve([])]);
  const list = pageOf(all, pageNumber(query.page));
  const links = list.items;
  // A shop's own questions are tested with that shop only (SR-45).
  const shops = ownerShopId ? allShops.filter((s) => s.id === ownerShopId) : allShops;

  return (
    <section aria-labelledby="test-links" className="mt-8">
      <h2 id="test-links" className="text-lg font-semibold text-brand-navy-900">
        Test links
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        Open this version as a respondent would, to test it end to end. Test links never contact customers, and their answers never count in reports.
      </p>

      {canManage && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
          <TestLinkForm versionId={versionId} shops={shops.map((s) => ({ id: s.id, name: s.name, isTestShop: s.isTestShop }))} />
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Created</th>
              <th scope="col" className="px-4 py-3 font-medium">Shop</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Alerts fired</th>
              <th scope="col" className="px-4 py-3 font-medium">Expires</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {links.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-left text-gray-500 sm:text-center">
                  No test links yet.
                </td>
              </tr>
            )}
            {links.map((l) => (
              <tr key={l.invitationId}>
                <td className="px-4 py-3 text-gray-700">{dateTime.format(l.createdAt)}</td>
                <td className="px-4 py-3 text-gray-700">{l.shopName}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[l.status].className}`}>{STATUS[l.status].label}</span>
                  {l.submittedAt && <span className="block text-xs text-gray-500">{dateTime.format(l.submittedAt)}</span>}
                  {l.status === "submitted" && l.responseId && (
                    <Link href={`/psg/instruments/${instrumentId}/responses/${l.responseId}`} className="block text-xs font-medium text-brand-navy-900 underline hover:text-brand-red">
                      View answers and scores
                    </Link>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-700">{l.status === "submitted" ? (l.alerts.length ? l.alerts.join(", ") : "None") : "–"}</td>
                <td className={`px-4 py-3 ${l.expired ? "text-red-700" : "text-gray-700"}`}>
                  {dateTime.format(l.expiresAt)}
                  {l.expired && " (expired)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...list} path={`/psg/instruments/${instrumentId}`} query={query} anchor="test-links" label="Test link pages" />
    </section>
  );
}
