"use client";

import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { PagedAnswerSheet } from "@/components/survey/pager";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import { computeOutcomes, evaluateAnswers, evaluateSubmission, type Answers } from "@/modules/instruments/evaluate";
import { buttonClass } from "./ui";

/**
 * Non-submitting preview (PDF 03: "Preview is non-submitting by default").
 * PSG fills in test answers to walk every branch and see the scores and
 * alerts the server evaluator would produce. Nothing is saved.
 */
export function Preview({ definition }: { definition: InstrumentDefinition }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState(false);
  // A new round starts the pages again from the first.
  const [round, setRound] = useState(0);

  const submission = useMemo(() => evaluateSubmission(definition, answers), [definition, answers]);
  const outcomes = useMemo(() => {
    const submitSet = evaluateAnswers(definition, answers, "submit").answers;
    return computeOutcomes(definition, submitSet);
  }, [definition, answers]);

  function reset() {
    setAnswers({});
    setChecked(false);
    setFinished(false);
    setRound((r) => r + 1);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Preview only, shown as customers see it, one page at a time. Answers here are never saved or counted. Each shop&apos;s own logo and colour show on its real survey.
        </p>
        <div className="rounded-lg bg-surface p-3 sm:p-6">
          <div className="rounded-lg bg-white px-5 pb-8 pt-6 shadow-md sm:px-10">
            {finished ? (
              <div role="status" className="py-10 text-center">
                <p className="text-xl font-semibold text-brand-navy-900">End of the survey</p>
                <p className="mt-2 text-sm text-gray-600">A customer would see the thank-you page now. The results are on the right.</p>
                <button type="button" onClick={reset} className={`${buttonClass.secondary} mt-6`}>
                  <RotateCcw aria-hidden="true" className="size-4" /> Start again
                </button>
              </div>
            ) : (
              <>
                {definition.intro && <p className="mb-6 text-gray-700">{definition.intro}</p>}
                <PagedAnswerSheet
                  key={round}
                  definition={definition}
                  answers={answers}
                  onChange={setAnswers}
                  idPrefix="preview"
                  finishLabel="Submit survey"
                  onFinish={() => {
                    setChecked(true);
                    setFinished(true);
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <aside aria-label="Preview results" className="flex h-fit flex-col gap-4 xl:sticky xl:top-20">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-brand-navy-900">What the server would record</h3>
            <button type="button" onClick={reset} className={buttonClass.ghost}>
              <RotateCcw aria-hidden="true" className="size-4" /> Reset
            </button>
          </div>

          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Metrics</h4>
          {definition.metrics.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">No metrics defined.</p>
          ) : (
            <dl className="mt-1 flex flex-col gap-1 text-sm">
              {definition.metrics.map((m) => {
                const value = outcomes.metrics[m.id];
                return (
                  <div key={m.id} className="flex justify-between gap-3">
                    <dt className="text-gray-600">{m.label}</dt>
                    <dd className="font-mono text-gray-900">{value === null || value === undefined ? "No score" : Number(value.toFixed(4))}</dd>
                  </div>
                );
              })}
            </dl>
          )}

          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Alerts</h4>
          {outcomes.alerts.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">None fired.</p>
          ) : (
            <ol className="mt-1 flex flex-col gap-1 text-sm">
              {outcomes.alerts.map((a, i) => (
                <li key={a.id} className="text-red-800">
                  {i === 0 ? "Primary: " : ""}
                  {a.label}
                </li>
              ))}
            </ol>
          )}

          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Suppression actions</h4>
          {outcomes.suppressions.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">None.</p>
          ) : (
            <ul className="mt-1 text-sm text-gray-800">
              {outcomes.suppressions.map((s) => (
                <li key={s.id}>{s.label}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <button type="button" onClick={() => setChecked(true)} className={`${buttonClass.secondary} w-full`}>
            Check as a submission
          </button>
          {checked && (
            <p className={`mt-2 text-sm ${submission.ok ? "text-emerald-800" : "text-red-800"}`} role="status">
              {submission.ok
                ? "These answers would be accepted."
                : `${submission.errors.length} problem${submission.errors.length === 1 ? "" : "s"} would block submission. They are shown on the questions.`}
            </p>
          )}
          {submission.ok && submission.droppedHidden.length > 0 && checked && (
            <p className="mt-1 text-xs text-gray-500">Hidden answers left out: {submission.droppedHidden.join(", ")}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
