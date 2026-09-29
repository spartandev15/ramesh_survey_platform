"use client";

import { useState, useTransition } from "react";
import { acknowledgeAction } from "../alerts/actions";

/** Acknowledge one identified change after doing it in FileMaker (SR-36). */
export function AckForm({ actionId, revision, results, identified }: { actionId: string; revision: number; results: [string, string][]; identified: boolean }) {
  const [result, setResult] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!identified) return <p className="text-xs text-amber-800">Match the response to its visit first, so the exact FileMaker record is known.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="sr-only" htmlFor={`result-${actionId}`}>
          What happened
        </label>
        <select id={`result-${actionId}`} value={result} onChange={(e) => setResult(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
          <option value="">What happened?</option>
          {results.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`evidence-${actionId}`}>
          What you did in FileMaker
        </label>
        <input
          id={`evidence-${actionId}`}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="What you did in FileMaker"
          className="min-w-48 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
        />
        <button
          type="button"
          disabled={pending || !result}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const r = await acknowledgeAction(actionId, revision, result as never, evidence);
              if (!r.ok) return setError(r.message);
            })
          }
          className="rounded-lg bg-brand-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Acknowledge
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
