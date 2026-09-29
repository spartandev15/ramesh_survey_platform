"use client";

import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { QuestionField } from "@/components/survey/question-field";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import { allQuestions } from "@/modules/instruments/questions";
import { computeOutcomes, evaluateAnswers, evaluateCondition, evaluateSubmission, type Answers, type AnswerValue } from "@/modules/instruments/evaluate";
import { buttonClass } from "./ui";

/**
 * Non-submitting preview (PDF 03: "Preview is non-submitting by default").
 * PSG fills in test answers to walk every branch and see the scores and
 * alerts the server evaluator would produce. Nothing is saved.
 */
export function Preview({ definition }: { definition: InstrumentDefinition }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [checked, setChecked] = useState(false);

  const questions = useMemo(() => allQuestions(definition), [definition]);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const evaluated = useMemo(() => evaluateAnswers(definition, answers, "draft"), [definition, answers]);
  const submission = useMemo(() => evaluateSubmission(definition, answers), [definition, answers]);
  const outcomes = useMemo(() => {
    const submitSet = evaluateAnswers(definition, answers, "submit").answers;
    return computeOutcomes(definition, submitSet);
  }, [definition, answers]);

  const visible = new Set(evaluated.visible);
  const errors = new Map<string, string>();
  for (const e of evaluated.errors) errors.set(e.questionId, e.message);
  if (checked && !submission.ok) for (const e of submission.errors) if (!errors.has(e.questionId)) errors.set(e.questionId, e.message);

  function isRequired(questionId: string): boolean {
    const q = byId.get(questionId);
    if (!q) return false;
    if (typeof q.required === "boolean") return q.required;
    const visibleAnswers = Object.fromEntries(Object.entries(evaluated.answers).filter(([id]) => visible.has(id)));
    return evaluateCondition(q.required, { questions: byId, answers: visibleAnswers });
  }

  const setAnswer = (id: string, value: AnswerValue | undefined) =>
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Preview only. Answers here are never saved or counted.</p>
        {definition.intro && <p className="text-sm text-gray-700">{definition.intro}</p>}
        {definition.pages.map((page, p) => {
          const pageQuestions = page.questions.filter((q) => visible.has(q.id));
          return (
            <section key={page.id} className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Page {p + 1}
                {page.title ? `: ${page.title}` : ""}
              </h3>
              {pageQuestions.length === 0 && <p className="mt-3 text-sm text-gray-500">No questions are shown on this page for the current answers.</p>}
              <div className="mt-4 flex flex-col gap-6">
                {pageQuestions.map((q) => (
                  <QuestionField
                    key={q.id}
                    idPrefix="preview"
                    question={q}
                    value={answers[q.id]}
                    error={errors.get(q.id)}
                    required={isRequired(q.id)}
                    onChange={(v) => setAnswer(q.id, v)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <aside aria-label="Preview results" className="flex h-fit flex-col gap-4 xl:sticky xl:top-20">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-brand-navy-900">What the server would record</h3>
            <button
              type="button"
              onClick={() => {
                setAnswers({});
                setChecked(false);
              }}
              className={buttonClass.ghost}
            >
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
