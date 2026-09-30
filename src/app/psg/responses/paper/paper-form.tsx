"use client";

import { CalendarDays, FileText, Info, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AnswerSheet, submissionErrors } from "@/components/survey/answer-sheet";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import type { Answers } from "@/modules/instruments/evaluate";
import { allQuestions } from "@/modules/instruments/questions";
import { enterPaperAction, searchVisitsAction } from "../actions";

const field = "h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-indigo-500";
const FORM_ID = "paper-entry";

/** Find an imported visit at the shop; choosing one reloads the form for that visit's pinned version. */
export function VisitPicker({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; label: string }[] | null>(null);
  const [pending, startTransition] = useTransition();

  function search(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => setResults(await searchVisitsAction(shopId, query)));
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="visit-search" className="text-sm font-medium text-gray-800">
            Find the visit <span className="font-normal text-gray-500">(visit ID, repair order or last name)</span>
          </label>
          <input id="visit-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Enter a visit ID, repair order number or last name" className={`${field} w-full`} />
        </div>
        <button
          type="submit"
          disabled={pending || query.trim().length < 2}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          <Search aria-hidden="true" className="size-4" />
          {pending ? "Searching…" : "Search"}
        </button>
      </form>
      {results && (
        <ul className="flex flex-col gap-1 rounded-lg border border-gray-100 bg-gray-50/60 p-2 text-sm">
          {results.length === 0 && <li className="px-2 py-1 text-gray-500">No visits found. You can still enter it without a visit; PSG matches it later.</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => router.push(`/psg/responses/paper?shop=${shopId}&visit=${r.id}`)} className="w-full rounded-md px-2 py-1.5 text-left text-indigo-700 transition hover:bg-white hover:underline">
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Staff entry of a paper form: same questions, validation and scoring as
 * online (SR-18). The page passes the shop and visit card and the summary
 * rows; this lays out the form beside a panel that shows how much is done
 * and holds the save button.
 */
export function PaperForm({
  shopId,
  visitId,
  definition,
  versionLabel,
  lead,
  summary,
}: {
  shopId: string;
  visitId: string | null;
  definition: InstrumentDefinition;
  versionLabel: string;
  /** The shop and visit card, shown first; it has forms of its own, so it sits outside this form. */
  lead: React.ReactNode;
  /** Summary rows for the side panel. */
  summary: React.ReactNode;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [receivedOn, setReceivedOn] = useState("");
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestKey = useRef<string>(crypto.randomUUID());

  // Progress: the shop, the date received and each required question still shown.
  const required = allQuestions(definition).filter((q) => q.required !== false);
  const missing = submissionErrors(definition, answers);
  const total = required.length + 2;
  const done = 1 + (receivedOn ? 1 : 0) + required.filter((q) => !missing.has(q.id)).length;
  const step = !receivedOn && Object.keys(answers).length === 0 ? 2 : missing.size > 0 || !receivedOn ? 3 : 4;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const problems = submissionErrors(definition, answers);
    if (!receivedOn) return setMessage("Enter the date the paper form was received.");
    if (problems.size > 0) {
      setErrors(problems);
      return setMessage("Some answers need attention. They are marked below.");
    }
    setMessage(null);
    startTransition(async () => {
      const result = await enterPaperAction({ shopId, visitId, receivedOn, answers, requestKey: requestKey.current });
      if (result.ok) return router.push(`/psg/responses/${result.responseId}`);
      if (result.errors?.length) setErrors(new Map(result.errors.map((x) => [x.questionId, x.message])));
      setMessage(result.message);
    });
  }

  return (
    <PaperLayout step={step} done={done} total={total} summary={summary} action={
      <button
        type="submit"
        form={FORM_ID}
        disabled={pending}
        aria-busy={pending}
        className="h-11 w-full rounded-xl bg-brand-red text-sm font-semibold text-white shadow-sm transition hover:bg-brand-red-dark disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save paper survey"}
      </button>
    }>
      {lead}
      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-5">
        {message && (
          <p role="alert" className="rounded-xl border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm text-brand-red-dark">
            {message}
          </p>
        )}
        <Card icon={CalendarDays} tone="bg-violet-50 text-violet-600" title="Form details" subtitle="Basic information from the paper survey.">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="received-on" className="text-sm font-medium text-gray-800">
              Date the paper form was received <span className="text-brand-red">(required)</span>
            </label>
            <input id="received-on" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={`${field} w-52`} />
          </div>
        </Card>
        <Card icon={FileText} tone="bg-emerald-50 text-emerald-600" title="Survey answers" subtitle={versionLabel}>
          <AnswerSheet definition={definition} answers={answers} onChange={setAnswers} errors={errors} idPrefix="paper" />
        </Card>
      </form>
    </PaperLayout>
  );
}

const STEPS = ["Select shop", "Find visit", "Enter answers", "Review & save"];

/** The page frame: steps across the top, the form on the left and the entry panel on the right. */
export function PaperLayout({ step, done, total, summary, action, children }: { step: number; done: number; total: number; summary: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "next";
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-2">
              <span
                className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold ${state === "current" ? "bg-indigo-600 text-white" : state === "done" ? "bg-emerald-100 text-emerald-700" : "border border-gray-300 bg-white text-gray-500"}`}
              >
                {state === "done" ? "✓" : n}
              </span>
              <span className={state === "current" ? "font-medium text-indigo-700" : "text-gray-600"}>{label}</span>
              {n < STEPS.length && <span aria-hidden="true" className="hidden h-px w-10 bg-gray-300 sm:block" />}
            </li>
          );
        })}
      </ol>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
        <aside aria-label="Survey entry" className="flex flex-col gap-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm lg:sticky lg:top-20">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600" aria-hidden="true">
              <FileText className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-brand-navy-900">Survey entry</h2>
              <p className="text-xs text-gray-500">Fill in every required item, then save.</p>
            </div>
          </div>
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-label="Required items complete" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {done} of {total} required items complete
            </p>
          </div>
          <div className="flex flex-col divide-y divide-gray-100 border-y border-gray-100">{summary}</div>
          <div className="rounded-xl bg-indigo-50/70 p-4 text-xs text-indigo-950">
            <p className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
              <Info aria-hidden="true" className="size-4" />
              Paper entry guidelines
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Enter answers exactly as written on the form.</li>
              <li>They are scored the same way as online answers.</li>
              <li>Your name is recorded as the person who entered them.</li>
              <li>Without a visit, the response is saved as pending customer match.</li>
            </ul>
          </div>
          {action}
        </aside>
      </div>
    </div>
  );
}

function Card({ icon: Icon, tone, title, subtitle, children }: { icon: typeof FileText; tone: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className={`rounded-xl p-2.5 ${tone}`} aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-brand-navy-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
