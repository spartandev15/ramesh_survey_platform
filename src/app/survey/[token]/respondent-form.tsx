"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuestionField } from "@/components/survey/question-field";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import { allQuestions } from "@/modules/instruments/questions";
import { evaluateAnswers, evaluateCondition, evaluateSubmission, type AnswerValue, type Answers } from "@/modules/instruments/evaluate";
import { saveDraftAction, submitAction } from "./actions";

type SaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "blocked"; message: string }
  | { kind: "failed"; message: string; reload?: boolean };

const AUTOSAVE_DELAY_MS = 800;

interface RespondentFormProps {
  token: string;
  definition: InstrumentDefinition;
  initialAnswers: Answers;
  initialRevision: number;
  initialSavedAt: string | null;
}

/**
 * The respondent survey (SR-16, SR-17, SR-39): one page at a time, answers
 * saved automatically with a visible state, back navigation without losing
 * answers, and server-side validation and scoring at submission.
 */
export function RespondentForm({ token, definition, initialAnswers, initialRevision, initialSavedAt }: RespondentFormProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [pageIndex, setPageIndex] = useState(0);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState<SaveStatus>(initialSavedAt ? { kind: "saved", at: new Date(initialSavedAt) } : { kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const revision = useRef(initialRevision);
  const latest = useRef(answers);
  const saving = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One key per page load: a double click or network retry replays the same submission (AT-17).
  const requestKey = useRef<string>(crypto.randomUUID());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const questions = useMemo(() => allQuestions(definition), [definition]);
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const evaluated = useMemo(() => evaluateAnswers(definition, answers, "draft"), [definition, answers]);
  const visible = useMemo(() => new Set(evaluated.visible), [evaluated]);

  // Pages with at least one visible question, in order. Hidden pages are skipped.
  const pages = definition.pages.map((page, index) => ({ page, index })).filter(({ page }) => page.questions.some((q) => visible.has(q.id)));
  const position = Math.max(0, Math.min(pageIndex, pages.length - 1));
  const current = pages[position];
  const isLast = position === pages.length - 1;

  const save = useCallback(async () => {
    if (saving.current || !dirty.current) return;
    const snapshot = latest.current;
    // Do not send an answer the server would reject (e.g. a number still out of range).
    if (evaluateAnswers(definition, snapshot, "draft").errors.length > 0) {
      setStatus({ kind: "blocked", message: "Not saved yet: fix the highlighted answer." });
      return;
    }
    saving.current = true;
    dirty.current = false;
    setStatus({ kind: "saving" });
    try {
      const result = await saveDraftAction({ token, expectedRevision: revision.current, answers: snapshot });
      if (result.ok) {
        revision.current = result.revision;
        setStatus({ kind: "saved", at: new Date(result.savedAt) });
      } else if (result.reason === "submitted" || result.reason === "expired") {
        router.refresh();
      } else if (result.reason === "stale") {
        setStatus({ kind: "failed", message: "This survey was updated in another window.", reload: true });
      } else {
        dirty.current = true;
        setStatus({ kind: "failed", message: result.reason === "rate_limited" ? "Saving is paused for a moment." : "Your answers could not be saved." });
      }
    } catch {
      dirty.current = true;
      setStatus({ kind: "failed", message: "Your answers could not be saved. Check your connection." });
    } finally {
      saving.current = false;
      // Answers typed while this save was in flight are saved next.
      if (dirty.current && timer.current === null) timer.current = setTimeout(runScheduled, AUTOSAVE_DELAY_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runScheduled is stable and defined below
  }, [definition, router, token]);

  const runScheduled = useCallback(() => {
    timer.current = null;
    void save();
  }, [save]);

  function setAnswer(id: string, value: AnswerValue | undefined) {
    const next = { ...latest.current };
    if (value === undefined) delete next[id];
    else next[id] = value;
    latest.current = next;
    setAnswers(next);
    dirty.current = true;
    setStatus({ kind: "pending" });
    if (errors.has(id)) {
      const rest = new Map(errors);
      rest.delete(id);
      setErrors(rest);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(runScheduled, AUTOSAVE_DELAY_MS);
  }

  // Warn before closing the tab with unsaved answers.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function isRequired(questionId: string): boolean {
    const q = byId.get(questionId);
    if (!q) return false;
    if (typeof q.required === "boolean") return q.required;
    const visibleAnswers = Object.fromEntries(Object.entries(evaluated.answers).filter(([id]) => visible.has(id)));
    return evaluateCondition(q.required, { questions: byId, answers: visibleAnswers });
  }

  /** Errors for the given question ids, using the same rules the server applies at submission. */
  function pageErrors(ids: Set<string>): Map<string, string> {
    const result = evaluateSubmission(definition, answers);
    const map = new Map<string, string>();
    if (!result.ok) for (const e of result.errors) if (ids.has(e.questionId) && !map.has(e.questionId)) map.set(e.questionId, e.message);
    return map;
  }

  function showErrors(map: Map<string, string>) {
    setErrors(map);
    // Move focus to the error summary so keyboard and screen reader users hear it (SR-39).
    requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }

  function goTo(nextPosition: number) {
    setErrors(new Map());
    setSubmitError(null);
    setPageIndex(nextPosition);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      headingRef.current?.focus();
    });
  }

  function next() {
    const ids = new Set(current.page.questions.filter((q) => visible.has(q.id)).map((q) => q.id));
    const problems = pageErrors(ids);
    if (problems.size > 0) return showErrors(problems);
    goTo(position + 1);
  }

  async function submit() {
    if (submitting) return;
    const ids = new Set(current.page.questions.filter((q) => visible.has(q.id)).map((q) => q.id));
    const problems = pageErrors(ids);
    if (problems.size > 0) return showErrors(problems);

    setSubmitting(true);
    setSubmitError(null);
    if (timer.current) clearTimeout(timer.current);
    try {
      const result = await submitAction({ token, requestKey: requestKey.current, answers: latest.current });
      if (result.ok || result.reason === "already_submitted" || result.reason === "expired") {
        dirty.current = false;
        router.refresh();
        return;
      }
      if (result.reason === "invalid" && result.errors?.length) {
        // The server found something the page check did not: go to the first affected page.
        const map = new Map(result.errors.map((e) => [e.questionId, e.message]));
        const target = pages.findIndex(({ page }) => page.questions.some((q) => map.has(q.id)));
        if (target >= 0 && target !== position) setPageIndex(target);
        showErrors(map);
      } else {
        setSubmitError(result.reason === "rate_limited" ? "Too many attempts. Please wait a minute and try again." : "Your survey could not be submitted.");
      }
    } catch {
      setSubmitError("Your survey could not be submitted. Check your connection and try again; your answers are kept.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!current) return <p className="text-gray-600">This survey has no questions to show.</p>;

  const errorList = [...errors.entries()].filter(([id]) => current.page.questions.some((q) => q.id === id));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (isLast) void submit();
        else next();
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
        <span>
          Page {position + 1} of {pages.length}
        </span>
        <SaveIndicator status={status} onRetry={() => void save()} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
        <div className="h-full rounded-full bg-brand-navy-900 transition-all" style={{ width: `${((position + 1) / pages.length) * 100}%` }} />
      </div>

      {position === 0 && definition.intro && <p className="text-gray-700">{definition.intro}</p>}

      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-brand-navy-900 outline-none">
        {current.page.title ?? `Part ${position + 1}`}
      </h1>

      {errorList.length > 0 && (
        <div ref={errorSummaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 outline-none">
          <p className="font-semibold">
            <AlertCircle aria-hidden="true" className="mr-1 inline size-4" />
            Please check {errorList.length === 1 ? "this answer" : `these ${errorList.length} answers`}:
          </p>
          <ul className="mt-2 list-disc pl-5">
            {errorList.map(([id, message]) => (
              <li key={id}>
                <a href={`#q-${id}`} className="underline">
                  {byId.get(id)?.title}
                </a>
                : {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-8">
        {current.page.questions
          .filter((q) => visible.has(q.id))
          .map((q) => (
            <div key={q.id} id={`q-${q.id}`} className="scroll-mt-6">
              <QuestionField idPrefix="survey" question={q} value={answers[q.id]} error={errors.get(q.id)} required={isRequired(q.id)} onChange={(v) => setAnswer(q.id, v)} />
            </div>
          ))}
      </div>

      {submitError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900">
          {submitError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-5">
        {position > 0 ? (
          <button type="button" onClick={() => goTo(position - 1)} className="rounded-lg border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 hover:border-brand-navy-700">
            Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="rounded-lg bg-brand-red px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-red-dark disabled:opacity-60"
        >
          {isLast ? (submitting ? "Submitting…" : "Submit survey") : "Next"}
        </button>
      </div>
    </form>
  );
}

/** Save state in words and an icon, never colour alone (AT-39). */
function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  return (
    <span role="status" aria-live="polite" className="flex items-center gap-1.5">
      {status.kind === "saving" && (
        <>
          <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Saving…
        </>
      )}
      {status.kind === "pending" && <>Unsaved changes</>}
      {status.kind === "saved" && (
        <>
          <Check aria-hidden="true" className="size-4 text-emerald-700" /> Saved {status.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </>
      )}
      {status.kind === "blocked" && (
        <>
          <AlertCircle aria-hidden="true" className="size-4 text-amber-700" /> {status.message}
        </>
      )}
      {status.kind === "failed" && (
        <>
          <AlertCircle aria-hidden="true" className="size-4 text-red-700" /> {status.message}
          <button type="button" onClick={status.reload ? () => window.location.reload() : onRetry} className="ml-1 font-medium text-brand-navy-900 underline">
            {status.reload ? "Reload to see the latest answers" : "Retry"}
          </button>
        </>
      )}
    </span>
  );
}
