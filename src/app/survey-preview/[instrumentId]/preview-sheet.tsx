"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { PagedAnswerSheet } from "@/components/survey/pager";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import type { Answers } from "@/modules/instruments/evaluate";

/** The customer's pages with the same checks, ending on the thank-you screen. Nothing is sent. */
export function PreviewSheet({ definition }: { definition: InstrumentDefinition }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);
  // A new round starts the pages again from the first.
  const [round, setRound] = useState(0);

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center py-6 text-center">
        <CheckCircle2 aria-hidden="true" className="size-12 text-emerald-600" />
        <h1 className="mt-4 text-2xl font-semibold text-brand-navy-900">Thank you for your feedback</h1>
        <p className="mt-2 max-w-md text-gray-600">This is where the customer&apos;s survey ends. In this preview nothing was saved.</p>
        <button
          type="button"
          onClick={() => {
            setAnswers({});
            setDone(false);
            setRound((r) => r + 1);
          }}
          className="mt-6 inline-flex items-center gap-2 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-brand-navy-700"
        >
          <RotateCcw aria-hidden="true" className="size-4" /> Start the preview again
        </button>
      </div>
    );
  }

  return (
    <>
      {definition.intro && <p className="mb-6 text-gray-700">{definition.intro}</p>}
      <PagedAnswerSheet key={round} definition={definition} answers={answers} onChange={setAnswers} idPrefix="preview" finishLabel="Submit survey" onFinish={() => setDone(true)} />
    </>
  );
}
