"use client";

import { CheckCircle2 } from "lucide-react";
import { useRef, useState } from "react";
import { AnswerSheet, submissionErrors } from "@/components/survey/answer-sheet";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import type { Answers } from "@/modules/instruments/evaluate";
import { submitPublicAction } from "./actions";

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-navy-700 focus:ring-2 focus:ring-brand-navy-700/20";

/**
 * Public shop survey (SR-13). The visit details are optional and only help
 * PSG connect the feedback to the right repair; they are never looked up here.
 */
export function PublicSurveyForm({
  slug,
  versionId,
  additionVersionId,
  shopName,
  definition,
}: {
  slug: string;
  versionId: string;
  additionVersionId: string | null;
  shopName: string;
  definition: InstrumentDefinition;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [context, setContext] = useState({ name: "", repairOrder: "", repairDate: "", contact: "" });
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  // One key per page load: a double click or retry saves once.
  const requestKey = useRef<string>(crypto.randomUUID());
  const summaryRef = useRef<HTMLDivElement>(null);

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center py-6 text-center">
        <CheckCircle2 aria-hidden="true" className="size-12 text-emerald-600" />
        <h1 className="mt-4 text-2xl font-semibold text-brand-navy-900">Thank you for your feedback</h1>
        <p className="mt-2 max-w-md text-gray-600">Your answers for {shopName} were received and saved.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const problems = submissionErrors(definition, answers);
    if (problems.size > 0) {
      setErrors(problems);
      setMessage("Some answers need attention. They are marked below.");
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await submitPublicAction({ slug, versionId, additionVersionId, answers, context, requestKey: requestKey.current });
      if (result.ok) return setDone(true);
      if (result.reason === "invalid" && result.errors) {
        setErrors(new Map(result.errors.map((x) => [x.questionId, x.message])));
        setMessage("Some answers need attention. They are marked below.");
      } else if (result.reason === "rate_limited") setMessage("Too many attempts. Please wait a minute and try again. Your answers are kept.");
      else if (result.reason === "changed") setMessage("This survey was just updated. Reload the page to see the current questions.");
      else setMessage("Your feedback could not be saved. Please try again.");
      requestAnimationFrame(() => summaryRef.current?.focus());
    } catch {
      setMessage("Your feedback could not be saved. Check your connection and try again; your answers are kept.");
    } finally {
      setPending(false);
    }
  }

  const setCtx = (key: keyof typeof context) => (e: React.ChangeEvent<HTMLInputElement>) => setContext((c) => ({ ...c, [key]: e.target.value }));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy-900">Tell {shopName} about your repair</h1>
        <p className="mt-2 text-sm text-gray-600">It takes a few minutes. Your answers help the team know what is working and what to improve.</p>
      </div>
      {message && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm text-brand-red-dark">
          {message}
        </div>
      )}

      <fieldset className="flex flex-col gap-4 rounded-xl bg-gray-50 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-800">About your visit (optional)</legend>
        <p className="text-xs text-gray-600">This helps connect your feedback to your repair. You can leave any of it blank.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="ctx-name" className="text-sm font-medium text-gray-700">
              Your name
            </label>
            <input id="ctx-name" autoComplete="name" value={context.name} onChange={setCtx("name")} className={field} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ctx-ro" className="text-sm font-medium text-gray-700">
              Repair order or claim number
            </label>
            <input id="ctx-ro" value={context.repairOrder} onChange={setCtx("repairOrder")} className={field} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ctx-date" className="text-sm font-medium text-gray-700">
              When you picked up your vehicle
            </label>
            <input id="ctx-date" type="date" value={context.repairDate} onChange={setCtx("repairDate")} className={field} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ctx-contact" className="text-sm font-medium text-gray-700">
              Email or phone
            </label>
            <input id="ctx-contact" autoComplete="email" value={context.contact} onChange={setCtx("contact")} className={field} />
          </div>
        </div>
      </fieldset>

      <AnswerSheet
        definition={definition}
        answers={answers}
        onChange={(next) => {
          setAnswers(next);
          if (errors.size) setErrors(new Map());
        }}
        errors={errors}
        idPrefix="public"
      />

      <button type="submit" disabled={pending} aria-busy={pending} className="self-start rounded-lg bg-brand-red px-6 py-3 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-60">
        {pending ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
