import type { Metadata } from "next";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listEmailProblems } from "@/modules/email-ledger/ledger";
import { STOP_LABELS } from "@/modules/email-ledger/policy";
import { REASON_LABELS } from "@/modules/imports/eligibility";
import { ResolveControls } from "./resolve-controls";

export const metadata: Metadata = { title: "Email review" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const STATE_LABELS: Record<string, string> = {
  held: "On hold",
  acceptance_unknown: "Outcome unknown",
  failed: "Failed",
  bounced: "Bounced",
};

const KIND_LABELS: Record<string, string> = { initial: "Invitation", reminder: "Reminder", renewal: "New link" };

const reasonLabel = (code: string | null) => (code ? (REASON_LABELS[code as keyof typeof REASON_LABELS] ?? STOP_LABELS[code] ?? code) : null);

/** Emails that need a person: nothing here is retried or released automatically (SR-23, SR-26). */
export default async function EmailReviewPage({ searchParams }: PageProps<"/psg/email">) {
  const current = await pageRequireCapability("operations.view");
  const canManage = hasCapability(current.principal, "import.manage");
  const query = await searchParams;
  const list = await listEmailProblems(pageNumber(query.page));
  const problems = list.items;

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Email review</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Survey emails that need a decision. When the outcome is unknown, check the email provider first, because sending again could email the customer twice. Held emails wait here after a pause
        instead of all sending at once.
      </p>
      <div className="relative mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Shop and visit
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Email
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Last attempt
              </th>
              {canManage && (
                <th scope="col" className="px-3 py-2 font-medium">
                  Decision
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {problems.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                  Nothing needs review.
                </td>
              </tr>
            )}
            {problems.map((p) => {
              const why = reasonLabel(p.stateReason) ?? p.lastError;
              return (
                <tr key={p.id} className="align-top">
                  <td className="px-3 py-3">
                    <span className="text-gray-900">{p.shopName}</span>
                    <span className="block font-mono text-xs text-gray-500">
                      {p.sourceVisitKey ?? "no visit"}
                      {p.isTest ? " · Test" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-800">{KIND_LABELS[p.kind] ?? p.kind}</td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-gray-900">{STATE_LABELS[p.state] ?? p.state}</span>
                    {why && <span className="block max-w-72 text-xs text-gray-600">{why}</span>}
                    <span className="block text-xs text-gray-500">
                      {p.attempts} attempt{p.attempts === 1 ? "" : "s"} · {p.events} provider event{p.events === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">{p.lastAttemptAt ? dateTime.format(p.lastAttemptAt) : "Not attempted"}</td>
                  {canManage && (
                    <td className="px-3 py-3">
                      <ResolveControls intentId={p.id} state={p.state} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination {...list} path="/psg/email" query={query} label="Email review pages" />
    </div>
  );
}
