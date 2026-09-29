"use client";

import { useState, useTransition } from "react";
import { handOffAction, noteAction, resolveAction } from "../actions";

type Result = { ok: true } | { ok: false; message: string };

function useAction() {
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

const ErrorText = ({ id, error }: { id: string; error: string | null }) =>
  error ? (
    <p id={id} role="alert" className="text-sm text-brand-red">
      {error}
    </p>
  ) : null;

/** Hub takes the case over from the legacy owner: an explicit, recorded decision (SR-46). */
export function HandoffForm({ caseId, revision, legacyOwner }: { caseId: string; revision: number; legacyOwner: string | null }) {
  const [agreed, setAgreed] = useState(false);
  const [note, setNote] = useState("");
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-4 accent-brand-navy-900" />
        <span>{legacyOwner ? `${legacyOwner} has stopped following this case up in the legacy system.` : "The legacy owner has stopped following this case up in the legacy system."}</span>
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor="handoff-note" className="text-sm font-medium text-gray-700">
          Who you agreed the handoff with, and when
        </label>
        <textarea
          id="handoff-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "handoff-error" : undefined}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <button
          type="button"
          disabled={pending || !agreed || note.trim().length === 0}
          onClick={() => run(() => handOffAction(caseId, revision, note))}
          className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Take over in Hub"}
        </button>
      </div>
      <ErrorText id="handoff-error" error={error} />
    </div>
  );
}

export function NoteForm({ caseId }: { caseId: string }) {
  const [body, setBody] = useState("");
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="legacy-note" className="text-sm font-medium text-gray-700">
        Add a follow-up note
      </label>
      <textarea id="legacy-note" value={body} onChange={(e) => setBody(e.target.value)} rows={2} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <div>
        <button
          type="button"
          disabled={pending || body.trim().length === 0}
          onClick={() => run(() => noteAction(caseId, body), () => setBody(""))}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-brand-navy-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add note"}
        </button>
      </div>
      <ErrorText id="note-error" error={error} />
    </div>
  );
}

export function ResolveForm({ caseId, revision, outcomes }: { caseId: string; revision: number; outcomes: [string, string][] }) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="legacy-outcome" className="text-sm font-medium text-gray-700">
          Outcome
        </label>
        <select id="legacy-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">Choose…</option>
          {outcomes.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="legacy-resolution" className="text-sm font-medium text-gray-700">
          How it was resolved
        </label>
        <textarea id="legacy-resolution" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <button
          type="button"
          disabled={pending || !outcome || note.trim().length === 0}
          onClick={() => run(() => resolveAction(caseId, revision, outcome, note))}
          className="rounded-lg bg-brand-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Confirm resolution"}
        </button>
      </div>
      <ErrorText id="resolve-error" error={error} />
    </div>
  );
}
