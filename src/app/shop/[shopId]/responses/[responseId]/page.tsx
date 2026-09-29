import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageRequireShopRead } from "@/modules/access/page-guards";
import { shopCaseForResponse } from "@/modules/cases/cases";
import { CATEGORY_LABELS } from "@/modules/dashboard/cohort";
import { getShopResponse } from "@/modules/dashboard/dashboard";
import { formatAnswer } from "@/modules/instruments/describe";

export const metadata: Metadata = { title: "Response" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const SOURCE_LABELS: Record<string, string> = { online: "Online link", paper: "Paper form", public: "Public form" };

/**
 * One response for the shop (SR-27). PSG-only matching evidence and contact
 * details the respondent typed are not shown here.
 */
export default async function ShopResponsePage({ params }: PageProps<"/shop/[shopId]/responses/[responseId]">) {
  const { shopId, responseId } = await params;
  await pageRequireShopRead(shopId);
  const data = await getShopResponse(shopId, responseId);
  if (!data) notFound();
  const { response } = data;
  const followUp = await shopCaseForResponse(shopId, response.id);

  return (
    <div className="max-w-4xl">
      <Link href={`/shop/${shopId}`} className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Survey dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Customer response</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{CATEGORY_LABELS[response.category]}</span>
        {response.isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Test data</span>}
      </div>
      {followUp && (
        <p className="mt-3 rounded-lg bg-brand-red/5 px-4 py-3 text-sm text-brand-red-dark">
          PSG asked you to follow up on this feedback.{" "}
          <Link href={`/shop/${shopId}/cases/${followUp.id}`} className="font-medium underline">
            Open the follow-up
          </Link>
        </p>
      )}
      {response.category === "pending_match" && (
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">PSG is connecting this response to the right repair visit. It will count in your scores once matched.</p>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-xl border border-gray-200 bg-white p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-500">Submitted</dt>
          <dd className="text-gray-900">{dateTime.format(response.submittedAt)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Source</dt>
          <dd className="text-gray-900">
            {SOURCE_LABELS[response.source]}
            {response.receivedOn ? ` · received ${response.receivedOn}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Survey</dt>
          <dd className="text-gray-900">
            {response.version.label}
            {response.correctedAt ? ` · corrected by PSG ${dateTime.format(response.correctedAt)}` : ""}
          </dd>
        </div>
      </dl>

      <section aria-label="Scores" className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Scores</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            {response.definition.metrics.map((m) => {
              const v = response.outcomes.metrics[m.id];
              return (
                <div key={m.id} className="flex justify-between gap-3">
                  <dt className="text-gray-700">{m.label}</dt>
                  <dd className="font-mono text-gray-900">{v === null || v === undefined ? "No score" : Number(v.toFixed(2))}</dd>
                </div>
              );
            })}
          </dl>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Negative feedback</h2>
          {response.outcomes.alerts.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">None.</p>
          ) : (
            <ul className="mt-2 text-sm text-red-800">
              {response.outcomes.alerts.map((a) => (
                <li key={a.id}>{a.label}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="answers" className="mt-6 rounded-xl border border-gray-200 bg-white">
        <h2 id="answers" className="border-b border-gray-100 px-5 py-3 text-base font-semibold text-brand-navy-900">
          Answers
        </h2>
        <dl className="divide-y divide-gray-100">
          {response.questions.map((q) => {
            const text = formatAnswer(q, response.answers[q.id]);
            return (
              <div key={q.id} className="grid gap-1 px-5 py-3 sm:grid-cols-2">
                <dt className="text-sm text-gray-700">{q.title}</dt>
                <dd className={`text-sm ${text ? "text-gray-900" : "italic text-gray-400"}`}>{text ?? "Skipped or not shown"}</dd>
              </div>
            );
          })}
        </dl>
      </section>
    </div>
  );
}
