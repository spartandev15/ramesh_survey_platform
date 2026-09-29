"use client";

import { useState, useTransition } from "react";
import { addDependencyAction, dependencyStatusAction, signRetirementAction } from "./actions";

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

const input = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";
const Err = ({ error }: { error: string | null }) =>
  error ? (
    <p role="alert" className="text-sm text-brand-red">
      {error}
    </p>
  ) : null;

export function AddDependency() {
  const [name, setName] = useState("");
  const [uses, setUses] = useState("");
  const { error, pending, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="dep-name" className="text-xs font-medium text-gray-700">
            FileMaker report, mail run or screen
          </label>
          <input id="dep-name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor="dep-uses" className="text-xs font-medium text-gray-700">
            What it uses from the bridge
          </label>
          <input id="dep-uses" value={uses} onChange={(e) => setUses(e.target.value)} placeholder="e.g. Survey results, suppression decisions" className={input} />
        </div>
        <button
          type="button"
          disabled={pending || !name.trim() || !uses.trim()}
          onClick={() =>
            run(
              () => addDependencyAction(name, uses),
              () => {
                setName("");
                setUses("");
              },
            )
          }
          className="rounded-lg bg-brand-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <Err error={error} />
    </div>
  );
}

export function DependencyStatus({ id, name, status, statuses }: { id: string; name: string; status: string; statuses: [string, string][] }) {
  const [next, setNext] = useState(status);
  const [outcome, setOutcome] = useState("");
  const { error, pending, run } = useRun();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="sr-only" htmlFor={`dep-status-${id}`}>
          State of {name}
        </label>
        <select id={`dep-status-${id}`} value={next} onChange={(e) => setNext(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
          {statuses.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {next !== "in_use" && (
          <>
            <label className="sr-only" htmlFor={`dep-outcome-${id}`}>
              {next === "replaced" ? `What replaced ${name}` : `Why ${name} is no longer needed`}
            </label>
            <input
              id={`dep-outcome-${id}`}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder={next === "replaced" ? "What replaced it" : "Why it is no longer needed"}
              className="min-w-40 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
            />
          </>
        )}
        <button
          type="button"
          disabled={pending || next === status}
          onClick={() => run(() => dependencyStatusAction(id, next, outcome), () => setOutcome(""))}
          aria-label={`Save state of ${name}`}
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:border-brand-navy-700 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <Err error={error} />
    </div>
  );
}

/** The final, signed retirement: only offered when nothing blocks it. */
export function SignRetirement() {
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const { error, pending, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="retire-owner" className="text-xs font-medium text-gray-700">
          FileMaker owner who agreed
        </label>
        <input id="retire-owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={`${input} max-w-sm`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="retire-note" className="text-xs font-medium text-gray-700">
          What was reconciled before retiring
        </label>
        <textarea id="retire-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={input} />
      </div>
      <div>
        <button
          type="button"
          disabled={pending || !owner.trim() || !note.trim()}
          onClick={() => run(() => signRetirementAction(owner, note))}
          className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Sign and switch the bridge off"}
        </button>
      </div>
      <Err error={error} />
    </div>
  );
}
