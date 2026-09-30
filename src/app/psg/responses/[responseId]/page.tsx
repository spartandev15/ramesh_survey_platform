import type { Metadata } from "next";
import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { allQuestions } from "@/modules/instruments/questions";
import { formatAnswer } from "@/modules/instruments/describe";
import { responseBridgeState } from "@/modules/bridge/bridge";
import { STATE_LABELS } from "@/modules/bridge/policy";
import { caseForResponse } from "@/modules/cases/cases";
import { findCandidateVisits, getResponse } from "@/modules/responses/staff";
import type { RespondentContext } from "@/modules/responses/staff-store";
import { listVisibleShops } from "@/modules/shops/shops";
import { responseStatus, SOURCE_LABELS } from "@/modules/responses/labels";
import { CorrectionPanel, DuplicatePanel, MatchPanel, ShopPanel } from "./panels";

export const metadata: Metadata = { title: "Response" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const DECISION_LABELS: Record<string, string> = {
  visit_matched: "Matched to visit",
  unresolved: "Checked, still unmatched",
  shop_confirmed: "Shop confirmed",
  duplicate_promoted: "Counted instead of the earlier response",
  duplicate_kept_original: "Kept the earlier counted response",
};

const CONTEXT_LABELS: Record<string, string> = { name: "Name", repairOrder: "Repair order or claim", repairDate: "Picked up", contact: "Email or phone" };

export default async function ResponseDetailPage({ params }: PageProps<"/psg/responses/[responseId]">) {
  const current = await pageRequireCapability("psg.workspace");
  const { responseId } = await params;
  const full = await getResponse(responseId);
  if (!full) notFound();

  const { response, definition, revisions, version } = full;
  const latest = revisions[revisions.length - 1];
  const questions = allQuestions(definition);
  const shopQuestionIds = new Set(full.addition?.questionIds ?? []);
  const status = responseStatus(response);
  const canMatch = hasCapability(current.principal, "match.manage");
  const canCorrect = hasCapability(current.principal, "response.correct");
  const ctx = (response.respondentContext ?? {}) as RespondentContext;
  const [candidates, shops, alertCase, bridge, countedFull] = await Promise.all([
    canMatch && response.matchStatus === "visit_unmatched" ? findCandidateVisits(response.id) : [],
    canMatch && response.matchStatus === "shop_unconfirmed" ? listVisibleShops() : [],
    caseForResponse(response.id),
    // Null while no FileMaker connection exists, so the page never implies a copy that is not proven (SR-35).
    responseBridgeState(response.id),
    // Duplicate review compares both answer sets side by side (PDF 03 §5).
    response.matchStatus === "duplicate_review" && full.counted ? getResponse(full.counted.id) : null,
  ]);
  const counted = countedFull ? countedFull.revisions[countedFull.revisions.length - 1] : null;

  return (
    <div className="max-w-5xl">
      <Link href="/psg/responses" className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Responses
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Response</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.style}`}>{status.label}</span>
        {response.isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Test data</span>}
        {/* A plain link: client-side navigation would try to render the CSV as a page. */}
        <a
          href={`/psg/responses/export?id=${response.id}`}
          download
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <Download aria-hidden="true" className="size-4" />
          Export CSV
        </a>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-xl border border-gray-200 bg-white p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-500">Shop</dt>
          <dd className="text-gray-900">{full.shopName ?? "Not confirmed (PSG only)"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Source</dt>
          <dd className="text-gray-900">
            {SOURCE_LABELS[response.source]}
            {response.receivedOn ? ` · received ${response.receivedOn}` : ""}
            {full.enteredByName ? ` · entered by ${full.enteredByName}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Submitted</dt>
          <dd className="text-gray-900">{response.submittedAt ? dateTime.format(response.submittedAt) : ""}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Visit</dt>
          <dd className="text-gray-900">
            {full.visit ? (
              <>
                <span className="font-mono">{full.visit.sourceVisitKey}</span> · {full.visit.customerName}
                {full.visit.deliveredOn ? ` · delivered ${full.visit.deliveredOn}` : ""}
              </>
            ) : (
              "Not matched yet"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Scored by</dt>
          <dd className="text-gray-900">
            Version {version.number}
            {version.isTest ? " (TEST)" : ""} · revision {latest.revision} of {revisions.length}
            {full.addition && ` · shop questions v${full.addition.number}${full.addition.isTest ? " (TEST)" : ""}`}
          </dd>
        </div>
        {/* SR-35: Hub is the only record until the R2 bridge; never imply a sync that did not happen. */}
        <div>
          <dt className="text-gray-500">FileMaker</dt>
          <dd className="text-gray-900">
            {bridge ? (
              <Link href="/psg/bridge" className="text-brand-navy-900 underline-offset-2 hover:underline">
                {STATE_LABELS[bridge.state]}
                {bridge.confirmedAt ? `, ${dateTime.format(bridge.confirmedAt)}` : ""}
              </Link>
            ) : (
              <>
                Not connected: this response is kept in Hub only.{" "}
                <Link href="/psg/suppression" className="text-brand-navy-900 underline-offset-2 hover:underline">
                  Routine-mail changes
                </Link>{" "}
                are made by hand.
              </>
            )}
          </dd>
        </div>
        {Object.keys(ctx).length > 0 && (
          <div>
            <dt className="text-gray-500">Respondent said</dt>
            <dd className="text-gray-900">
              {Object.entries(ctx).map(([k, v]) => (
                <span key={k} className="block">
                  {CONTEXT_LABELS[k] ?? k}: {v}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      {alertCase && (
        <p className="mt-4 rounded-lg bg-brand-red/5 px-4 py-3 text-sm text-brand-red-dark">
          Negative feedback case:{" "}
          <Link href={`/psg/alerts/${alertCase.id}`} className="font-medium underline">
            {alertCase.status === "pending_review" ? "waiting for PSG review" : alertCase.status === "dismissed" ? "dismissed" : `approved, follow-up ${alertCase.followUp.replace("_", " ")}`}
          </Link>
        </p>
      )}

      {response.matchStatus === "duplicate_review" && full.counted && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Another response already counts for this visit:{" "}
          <Link href={`/psg/responses/${full.counted.id}`} className="font-medium underline">
            {SOURCE_LABELS[full.counted.source]}, {full.counted.submittedAt ? dateTime.format(full.counted.submittedAt) : ""}
          </Link>
          . Compare the answers, then decide below.
        </p>
      )}

      {canMatch && response.matchStatus !== "matched" && (
        <section aria-labelledby="decision-heading" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="decision-heading" className="text-base font-semibold text-brand-navy-900">
            {response.matchStatus === "visit_unmatched" ? "Match to a visit" : response.matchStatus === "shop_unconfirmed" ? "Confirm the shop" : "Duplicate decision"}
          </h2>
          <div className="mt-3">
            {response.matchStatus === "visit_unmatched" && <MatchPanel responseId={response.id} matchRevision={response.matchRevision} initial={candidates} />}
            {response.matchStatus === "shop_unconfirmed" && (
              <ShopPanel responseId={response.id} matchRevision={response.matchRevision} suggestions={full.suggestions} shops={shops.map((s) => ({ id: s.id, name: s.name }))} />
            )}
            {response.matchStatus === "duplicate_review" && <DuplicatePanel responseId={response.id} matchRevision={response.matchRevision} />}
          </div>
        </section>
      )}

      <section aria-labelledby="outcomes-heading" className="mt-6 grid gap-4 sm:grid-cols-2">
        <h2 id="outcomes-heading" className="sr-only">
          Current scores and alerts
        </h2>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Metrics</h3>
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            {definition.metrics.length === 0 && <p className="text-gray-500">None defined.</p>}
            {definition.metrics.map((m) => {
              const value = latest.outcomes.metrics[m.id];
              return (
                <div key={m.id} className="flex justify-between gap-3">
                  <dt className="text-gray-600">{m.label}</dt>
                  <dd className="font-mono text-gray-900">{value === null || value === undefined ? "No score" : Number(value.toFixed(4))}</dd>
                </div>
              );
            })}
          </dl>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Alerts</h3>
          {latest.outcomes.alerts.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">None fired.</p>
          ) : (
            <ul className="mt-2 text-sm text-red-800">
              {latest.outcomes.alerts.map((a) => (
                <li key={a.id}>{a.label}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="answers-heading" className="mt-6 rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <h2 id="answers-heading" className="text-base font-semibold text-brand-navy-900">
            {counted ? "Answers compared with the counted response" : "Answers (current revision)"}
          </h2>
        </div>
        {counted && countedFull && (
          <div className="hidden gap-1 border-b border-gray-100 bg-gray-50 px-5 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 sm:grid sm:grid-cols-3">
            <span>Question</span>
            <span>This response · {SOURCE_LABELS[response.source]}</span>
            <span>
              Counted · {SOURCE_LABELS[countedFull.response.source]}
              {countedFull.response.submittedAt ? `, ${dateTime.format(countedFull.response.submittedAt)}` : ""}
            </span>
          </div>
        )}
        <dl className="divide-y divide-gray-100">
          {questions.map((q) => {
            const text = formatAnswer(q, latest.answers[q.id]);
            const other = counted ? formatAnswer(q, counted.answers[q.id]) : undefined;
            const differs = counted && JSON.stringify(latest.answers[q.id]) !== JSON.stringify(counted.answers[q.id]);
            return (
              <div key={q.id} className={`grid gap-1 px-5 py-3 ${counted ? "sm:grid-cols-3" : "sm:grid-cols-2"} ${differs ? "bg-amber-50/60" : ""}`}>
                <dt className="text-sm text-gray-700">
                  {q.title}
                  {shopQuestionIds.has(q.id) && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">Shop question, not scored</span>}
                </dt>
                <dd className={`text-sm ${text ? "text-gray-900" : "italic text-gray-400"}`}>
                  {counted && <span className="text-xs font-medium not-italic text-gray-500 sm:hidden">This response: </span>}
                  {text ?? "Skipped or not shown"}
                </dd>
                {counted && (
                  <dd className={`text-sm ${other ? "text-gray-900" : "italic text-gray-400"}`}>
                    <span className="text-xs font-medium not-italic text-gray-500 sm:hidden">Counted: </span>
                    {other ?? "Skipped or not shown"}
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
        {canCorrect && (
          <div className="border-t border-gray-100 px-5 py-4">
            <CorrectionPanel key={latest.revision} responseId={response.id} revision={latest.revision} definition={definition} answers={latest.answers} />
          </div>
        )}
      </section>

      <section aria-labelledby="history-heading" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 id="history-heading" className="text-base font-semibold text-brand-navy-900">
          History
        </h2>
        <ol className="mt-3 flex flex-col gap-4">
          {revisions.map((rev, i) => {
            const previous = revisions[i - 1];
            const changed = previous ? questions.filter((q) => JSON.stringify(previous.answers[q.id]) !== JSON.stringify(rev.answers[q.id])) : [];
            return (
              <li key={rev.revision} className="border-l-2 border-gray-200 pl-3 text-sm">
                <p className="text-xs text-gray-500">
                  {dateTime.format(rev.createdAt)} · {rev.actorName ?? (rev.actorType === "respondent" ? "Respondent" : "System")} · revision {rev.revision}
                </p>
                <p className="text-gray-900">{rev.revision === 1 ? "Original submission" : `Correction: ${rev.reason}`}</p>
                {changed.length > 0 && (
                  <ul className="mt-1 text-xs text-gray-700">
                    {changed.map((q) => (
                      <li key={q.id}>
                        {q.title}: {formatAnswer(q, previous.answers[q.id]) ?? "blank"} → {formatAnswer(q, rev.answers[q.id]) ?? "blank"}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {full.decisions.map((d, i) => (
            <li key={`d${i}`} className="border-l-2 border-brand-navy-700/30 pl-3 text-sm">
              <p className="text-xs text-gray-500">
                {dateTime.format(d.createdAt)} · {d.actorName ?? "System"}
              </p>
              <p className="text-gray-900">
                {DECISION_LABELS[d.kind] ?? d.kind}
                {d.shopName ? ` · ${d.shopName}` : ""}
              </p>
              {d.evidence && <p className="text-xs text-gray-600">{d.evidence}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
