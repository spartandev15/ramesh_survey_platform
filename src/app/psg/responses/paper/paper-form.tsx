"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AnswerSheet, submissionErrors } from "@/components/survey/answer-sheet";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import type { Answers } from "@/modules/instruments/evaluate";
import { enterPaperAction, searchVisitsAction } from "../actions";

const field = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy-700";

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
        <div className="flex flex-col gap-1">
          <label htmlFor="visit-search" className="text-sm font-medium text-gray-700">
            Find the visit (visit ID, repair order or last name)
          </label>
          <input id="visit-search" value={query} onChange={(e) => setQuery(e.target.value)} className={`${field} w-72 max-w-full`} />
        </div>
        <button type="submit" disabled={pending || query.trim().length < 2} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 disabled:opacity-50">
          {pending ? "Searching…" : "Search"}
        </button>
      </form>
      {results && (
        <ul className="flex flex-col gap-1 text-sm">
          {results.length === 0 && <li className="text-gray-500">No visits found. You can still enter it without a visit; PSG matches it later.</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => router.push(`/psg/responses/paper?shop=${shopId}&visit=${r.id}`)} className="text-left text-brand-navy-900 underline-offset-2 hover:underline">
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Staff entry of a paper form: same questions, validation and scoring as online (SR-18). */
export function PaperForm({ shopId, visitId, definition }: { shopId: string; visitId: string | null; definition: InstrumentDefinition }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [receivedOn, setReceivedOn] = useState("");
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestKey = useRef<string>(crypto.randomUUID());

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
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {message && (
        <p role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm text-brand-red-dark">
          {message}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="received-on" className="text-sm font-medium text-gray-700">
          Date the paper form was received <span className="text-brand-red">(required)</span>
        </label>
        <input id="received-on" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className={`${field} w-48`} />
      </div>
      <AnswerSheet definition={definition} answers={answers} onChange={setAnswers} errors={errors} idPrefix="paper" />
      <button type="submit" disabled={pending} aria-busy={pending} className="self-start rounded-lg bg-brand-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-60">
        {pending ? "Saving…" : "Save paper survey"}
      </button>
    </form>
  );
}
