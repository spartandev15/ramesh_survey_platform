"use client";

import { useMemo } from "react";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import { allQuestions } from "@/modules/instruments/questions";
import { evaluateAnswers, evaluateCondition, evaluateSubmission, type AnswerValue, type Answers } from "@/modules/instruments/evaluate";
import { QuestionField } from "./question-field";

/**
 * Every visible question of a survey on one screen, with the same visibility
 * and requiredness rules the server applies. Used for paper entry,
 * corrections and the public shop form; the server still validates on save.
 */
export function AnswerSheet({
  definition,
  answers,
  onChange,
  errors,
  idPrefix,
}: {
  definition: InstrumentDefinition;
  answers: Answers;
  onChange: (answers: Answers) => void;
  errors: Map<string, string>;
  idPrefix: string;
}) {
  const questions = useMemo(() => allQuestions(definition), [definition]);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const evaluated = useMemo(() => evaluateAnswers(definition, answers, "draft"), [definition, answers]);
  const visible = new Set(evaluated.visible);

  function isRequired(questionId: string): boolean {
    const q = byId.get(questionId);
    if (!q) return false;
    if (typeof q.required === "boolean") return q.required;
    const visibleAnswers = Object.fromEntries(Object.entries(evaluated.answers).filter(([id]) => visible.has(id)));
    return evaluateCondition(q.required, { questions: byId, answers: visibleAnswers });
  }

  function set(id: string, value: AnswerValue | undefined) {
    const next = { ...answers };
    if (value === undefined) delete next[id];
    else next[id] = value;
    onChange(next);
  }

  const draftErrors = new Map(evaluated.errors.map((e) => [e.questionId, e.message]));

  return (
    <div className="flex flex-col gap-6">
      {definition.pages.map((page) => {
        const shown = page.questions.filter((q) => visible.has(q.id));
        if (shown.length === 0) return null;
        return (
          <fieldset key={page.id} className="flex flex-col gap-6">
            {page.title && <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{page.title}</legend>}
            {shown.map((q) => (
              <QuestionField
                key={q.id}
                idPrefix={idPrefix}
                question={q}
                value={answers[q.id]}
                error={errors.get(q.id) ?? draftErrors.get(q.id)}
                required={isRequired(q.id)}
                onChange={(v) => set(q.id, v)}
              />
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}

/** The server's submission errors for the current answers, keyed by question. */
export function submissionErrors(definition: InstrumentDefinition, answers: Answers): Map<string, string> {
  const result = evaluateSubmission(definition, answers);
  return result.ok ? new Map() : new Map(result.errors.map((e) => [e.questionId, e.message]));
}
