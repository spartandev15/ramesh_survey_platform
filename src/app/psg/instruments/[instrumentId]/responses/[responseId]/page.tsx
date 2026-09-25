import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { formatAnswer } from "@/modules/instruments/describe";
import { getTestResponse } from "@/modules/responses/test-links";
import { TestBadge } from "../../../version-badges";

export const metadata: Metadata = { title: "Test response" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" });

/**
 * One submitted test response: the answers, the outcomes the server
 * computed, and the exact rule version that computed them (AT-14, AT-15).
 */
export default async function TestResponsePage({ params }: PageProps<"/psg/instruments/[instrumentId]/responses/[responseId]">) {
  await pageRequireCapability("psg.workspace");
  const { instrumentId, responseId } = await params;
  const detail = await getTestResponse(responseId);
  if (!detail || detail.instrumentId !== instrumentId) notFound();

  const { definition, revision } = detail;
  const { outcomes } = revision;

  return (
    <div className="max-w-4xl">
      <Link href={`/psg/instruments/${instrumentId}?version=${detail.version.number}`} className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Version {detail.version.number}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Test response</h1>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Test data</span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-xl border border-gray-200 bg-white p-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Shop</dt>
          <dd className="text-gray-900">{detail.shopName ?? "Not confirmed"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Submitted</dt>
          <dd className="text-gray-900">
            {dateTime.format(detail.submittedAt)} · {detail.source}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Scored by</dt>
          <dd className="flex flex-wrap items-center gap-2 text-gray-900">
            Version {detail.version.number} <TestBadge isTest={detail.version.isTest} /> · evaluator v{revision.evaluatorVersion} · revision {revision.number}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Rule content hash</dt>
          <dd className="break-all font-mono text-xs text-gray-900">{revision.definitionHash}</dd>
        </div>
      </dl>

      <section aria-labelledby="outcomes" className="mt-6 grid gap-4 sm:grid-cols-3">
        <h2 id="outcomes" className="sr-only">
          Computed outcomes
        </h2>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Metrics</h3>
          {definition.metrics.length === 0 && <p className="mt-2 text-sm text-gray-500">None defined.</p>}
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            {definition.metrics.map((m) => {
              const value = outcomes.metrics[m.id];
              return (
                <div key={m.id} className="flex justify-between gap-3">
                  <dt className="text-gray-600">{m.label}</dt>
                  {/* Stored unrounded; shown to 4 places for review only. */}
                  <dd className="font-mono text-gray-900">{value === null || value === undefined ? "No score" : Number(value.toFixed(4))}</dd>
                </div>
              );
            })}
          </dl>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Alerts</h3>
          {outcomes.alerts.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">None fired.</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-1 text-sm text-red-800">
              {outcomes.alerts.map((a, i) => (
                <li key={a.id}>
                  {i === 0 ? "Primary: " : ""}
                  {a.label}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Suppression actions</h3>
          {outcomes.suppressions.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">None.</p>
          ) : (
            <ul className="mt-2 text-sm text-gray-800">
              {outcomes.suppressions.map((s) => (
                <li key={s.id}>{s.label}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <h2 className="mt-8 text-lg font-semibold text-brand-navy-900">Answers</h2>
      <div className="mt-3 flex flex-col gap-4">
        {definition.pages.map((page, p) => (
          <section key={page.id} className="rounded-xl border border-gray-200 bg-white">
            <h3 className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">
              Page {p + 1}
              {page.title ? `: ${page.title}` : ""}
            </h3>
            <dl className="divide-y divide-gray-100">
              {page.questions.map((q) => {
                const text = formatAnswer(q, revision.answers[q.id]);
                return (
                  <div key={q.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[1fr_1fr]">
                    <dt className="text-sm text-gray-700">
                      {q.title}
                      <span className="block font-mono text-xs text-gray-400">{q.id}</span>
                    </dt>
                    <dd className={`text-sm ${text ? "text-gray-900" : "italic text-gray-400"}`}>
                      {text ?? "Skipped or not shown"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
