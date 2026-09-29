"use client";

import { useState, useTransition } from "react";
import { confirmGateAction, keepHubAction, retryAction, withdrawGateAction } from "./actions";

type Result = { ok: true } | { ok: false; message: string };

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>, onDone?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.message);
      else onDone?.();
    });
  return { error, pending, run };
}

/** Record or withdraw one go-live check (SR-42, G-09). */
export function GateControl({ item, label, confirmed }: { item: string; label: string; confirmed: boolean }) {
  const [note, setNote] = useState("");
  const { error, pending, run } = useRun();
  const id = `gate-${item}`;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {confirmed ? (
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => withdrawGateAction(item))}
            aria-label={`Withdraw check: ${label}`}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:border-brand-navy-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Withdraw"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <label htmlFor={id} className="text-xs font-medium text-gray-700">
              What was checked, and with whom<span className="sr-only"> for {label}</span>
            </label>
            <input id={id} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs" />
          </div>
          <button
            type="button"
            disabled={pending || note.trim().length === 0}
            onClick={() => run(() => confirmGateAction(item, note), () => setNote(""))}
            aria-label={`Record check: ${label}`}
            className="rounded-lg bg-brand-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Record"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}

/** Settle one failed or conflicting write. Hub's data never changes from FileMaker. */
export function ProblemControl({ eventId, state }: { eventId: string; state: string }) {
  const [note, setNote] = useState("");
  const { error, pending, run } = useRun();
  if (state === "retrying") return <span className="text-xs text-gray-600">Retrying automatically</span>;
  return (
    <div className="flex flex-col gap-1">
      {state === "failed" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => retryAction(eventId))}
          className="self-start rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-brand-navy-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Try again"}
        </button>
      )}
      {state === "conflict" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <label htmlFor={`keep-${eventId}`} className="text-xs font-medium text-gray-700">
              What you checked with the FileMaker owner
            </label>
            <input id={`keep-${eventId}`} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs" />
          </div>
          <button
            type="button"
            disabled={pending || note.trim().length === 0}
            onClick={() => run(() => keepHubAction(eventId, note))}
            className="rounded-lg bg-brand-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Put Hub's version back"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
