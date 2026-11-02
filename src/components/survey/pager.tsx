"use client";

import { AlertCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InstrumentDefinition, Question } from "@/modules/instruments/definition";
import { allQuestions } from "@/modules/instruments/questions";
import { evaluateAnswers, evaluateCondition, evaluateSubmission, type AnswerValue, type Answers } from "@/modules/instruments/evaluate";
import { QuestionField } from "./question-field";

/** How far through the survey the respondent is, as a labelled bar under the buttons. */
export function SurveyProgress({ position, total }: { position: number; total: number }) {
  const percent = total > 0 ? Math.round((position / total) * 100) : 0;
  return (
    <div className="mt-6 flex justify-center">
      <div role="progressbar" aria-label="Survey progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="flex h-5 w-52 overflow-hidden rounded-full bg-gray-300 text-xs font-medium">
        <span className="flex min-w-11 items-center justify-center rounded-full bg-brand-navy-900 px-2 text-white" style={{ width: `${Math.max(percent, 0)}%` }}>
          {percent}%
        </span>
      </div>
    </div>
  );
}

const buttonClass = "rounded bg-brand-red px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-red-dark disabled:opacity-60";

/** Back and Next (or the finishing button), centred under the questions. */
export function PagerButtons({ onBack, next, pending = false }: { onBack?: () => void; next: string; pending?: boolean }) {
  return (
    <div className="mt-8 flex justify-center gap-2 border-t border-gray-200 pt-8">
      {onBack && (
        <button type="button" onClick={onBack} className={buttonClass}>
          Back
        </button>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass}>
        {next}
      </button>
    </div>
  );
}

/** The errors on one page, listed at its top and focusable so keyboard and screen reader users hear them (SR-39). */
function PageErrors({ errors, byId, ref }: { errors: [string, string][]; byId: Map<string, Question>; ref: React.Ref<HTMLDivElement> }) {
  if (errors.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 outline-none">
      <p className="font-semibold">
        <AlertCircle aria-hidden="true" className="mr-1 inline size-4" />
        Please check {errors.length === 1 ? "this answer" : `these ${errors.length} answers`}:
      </p>
      <ul className="mt-2 list-disc pl-5">
        {errors.map(([id, message]) => (
          <li key={id}>
            <a href={`#q-${id}`} className="underline">
              {byId.get(id)?.title}
            </a>
            : {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The visible questions of one page, separated by thin rules like a paper form. */
function PageQuestions({
  questions,
  answers,
  errors,
  idPrefix,
  isRequired,
  onAnswer,
}: {
  questions: Question[];
  answers: Answers;
  errors: Map<string, string>;
  idPrefix: string;
  isRequired: (id: string) => boolean;
  onAnswer: (id: string, value: AnswerValue | undefined) => void;
}) {
  return (
    <div className="flex flex-col divide-y divide-gray-200">
      {questions.map((q) => (
        <div key={q.id} id={`q-${q.id}`} className="scroll-mt-6 py-6 first:pt-0">
          <QuestionField idPrefix={idPrefix} question={q} value={answers[q.id]} error={errors.get(q.id)} required={isRequired(q.id)} onChange={(v) => onAnswer(q.id, v)} />
        </div>
      ))}
    </div>
  );
}

const NO_ERRORS = new Map<string, string>();

/**
 * A survey one page at a time with Back, Next and a progress bar, for forms whose answers
 * are held on the page until the end (the public shop form and the builder preview). Each
 * Next checks that page with the server's rules; `finish` runs on the last page.
 */
export function PagedAnswerSheet({
  definition,
  answers,
  onChange,
  errors = NO_ERRORS,
  idPrefix,
  finishLabel,
  pending,
  onFinish,
  first,
  notice,
}: {
  definition: InstrumentDefinition;
  answers: Answers;
  onChange: (answers: Answers) => void;
  /** Errors from outside (the server's reply): the sheet moves to the first page that has one. Pass a new Map only for a new reply. */
  errors?: Map<string, string>;
  idPrefix: string;
  finishLabel: string;
  pending?: boolean;
  onFinish: () => void;
  /** Shown above the questions of the first page. */
  first?: React.ReactNode;
  /** A message shown at the top of every page (e.g. a failed send). */
  notice?: React.ReactNode;
}) {
  const questions = useMemo(() => allQuestions(definition), [definition]);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const evaluated = useMemo(() => evaluateAnswers(definition, answers, "draft"), [definition, answers]);
  const visible = useMemo(() => new Set(evaluated.visible), [evaluated]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageErrors, setPageErrors] = useState<Map<string, string>>(new Map());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focus = useRef<"heading" | "summary" | null>(null);

  const pages = definition.pages.filter((page) => page.questions.some((q) => visible.has(q.id)));
  const position = Math.max(0, Math.min(pageIndex, pages.length - 1));
  const current = pages[position];
  const isLast = position === pages.length - 1;
  const draftErrors = new Map(evaluated.errors.map((e) => [e.questionId, e.message]));
  const shownErrors = new Map([...draftErrors, ...errors, ...pageErrors]);

  // A server reply with errors: show the first page that has one (the caller's notice takes the focus).
  const [seenErrors, setSeenErrors] = useState(errors);
  if (errors !== seenErrors) {
    setSeenErrors(errors);
    const target = pages.findIndex((page) => page.questions.some((q) => errors.has(q.id)));
    if (target >= 0) setPageIndex(target);
  }

  useEffect(() => {
    const want = focus.current;
    const target = want === "summary" ? summaryRef.current : want === "heading" ? headingRef.current : null;
    if (!target) return;
    focus.current = null;
    if (want === "heading") window.scrollTo({ top: 0 });
    target.focus();
  });

  if (!current) return <p className="text-gray-600">This survey has no questions to show.</p>;

  function isRequired(questionId: string): boolean {
    const q = byId.get(questionId);
    if (!q) return false;
    if (typeof q.required === "boolean") return q.required;
    const visibleAnswers = Object.fromEntries(Object.entries(evaluated.answers).filter(([id]) => visible.has(id)));
    return evaluateCondition(q.required, { questions: byId, answers: visibleAnswers });
  }

  function onAnswer(id: string, value: AnswerValue | undefined) {
    const next = { ...answers };
    if (value === undefined) delete next[id];
    else next[id] = value;
    if (pageErrors.has(id)) setPageErrors((m) => new Map([...m].filter(([k]) => k !== id)));
    onChange(next);
  }

  function goTo(index: number) {
    setPageErrors(new Map());
    setPageIndex(index);
    focus.current = "heading";
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const ids = new Set(current.questions.filter((q) => visible.has(q.id)).map((q) => q.id));
    const result = evaluateSubmission(definition, answers);
    const problems = new Map<string, string>();
    if (!result.ok) for (const x of result.errors) if (ids.has(x.questionId) && !problems.has(x.questionId)) problems.set(x.questionId, x.message);
    if (problems.size > 0) {
      setPageErrors(problems);
      focus.current = "summary";
      return;
    }
    if (isLast) onFinish();
    else goTo(position + 1);
  }

  const shown = current.questions.filter((q) => visible.has(q.id));
  const errorList = shown.filter((q) => shownErrors.has(q.id) && (pageErrors.has(q.id) || errors.has(q.id))).map((q): [string, string] => [q.id, shownErrors.get(q.id)!]);

  return (
    <form onSubmit={submit} noValidate>
      {position === 0 && first}
      <h2 ref={headingRef} tabIndex={-1} className={current.title ? "mb-6 text-xl font-semibold text-brand-navy-900 outline-none" : "sr-only"}>
        {current.title ?? `Part ${position + 1} of ${pages.length}`}
      </h2>
      {notice}
      <PageErrors errors={errorList} byId={byId} ref={summaryRef} />
      <PageQuestions questions={shown} answers={answers} errors={shownErrors} idPrefix={idPrefix} isRequired={isRequired} onAnswer={onAnswer} />
      <PagerButtons onBack={position > 0 ? () => goTo(position - 1) : undefined} next={isLast ? finishLabel : "Next"} pending={pending} />
      <SurveyProgress position={position} total={pages.length} />
    </form>
  );
}
