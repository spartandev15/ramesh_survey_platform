"use client";

import { useState, useTransition } from "react";
import { commitImportAction, saveMappingAction } from "../actions";

interface FieldOption {
  key: string;
  label: string;
  required: boolean;
}

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy-700";

/** PSG confirms which column holds each field. The preview below updates after saving. */
export function MappingEditor({ batchId, revision, headers, fields, mapping }: { batchId: string; revision: number; headers: string[]; fields: FieldOption[]; mapping: Record<string, string> }) {
  const [values, setValues] = useState(mapping);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(values) !== JSON.stringify(mapping);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveMappingAction(batchId, revision, values);
      if (!result.ok) return setError([result.message, ...(result.issues ?? [])].join(" "));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label htmlFor={`map-${f.key}`} className="text-sm font-medium text-gray-700">
              {f.label}
              {f.required && <span className="text-brand-red"> (required)</span>}
            </label>
            <select id={`map-${f.key}`} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={field}>
              <option value="">Not in this file</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending || !dirty} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:border-brand-navy-700 disabled:opacity-50">
          {pending ? "Saving…" : "Save mapping and refresh preview"}
        </button>
        {dirty && <span className="text-xs text-amber-800">Unsaved changes. The preview shows the saved mapping.</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}

/** Commit writes every row's outcome. Only eligible new visits in a Live shop get an email queued. */
export function CommitPanel({ batchId, revision, sendCount, blocked }: { batchId: string; revision: number; sendCount: number; blocked: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<{ message: string; issues?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function commit() {
    setError(null);
    startTransition(async () => {
      const result = await commitImportAction(batchId, revision);
      if (!result.ok) return setError({ message: result.message, issues: result.issues });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-700">
        {sendCount === 0
          ? "Committing creates the records shown. No emails will be queued."
          : `Committing creates the records shown and queues ${sendCount} survey invitation email${sendCount === 1 ? "" : "s"}.`}
      </p>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={blocked} className="mt-0.5 size-4 accent-brand-red" />
        <span>I reviewed the preview for this shop.</span>
      </label>
      <div>
        <button type="button" onClick={commit} disabled={pending || !confirmed || blocked} className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50">
          {pending ? "Committing…" : "Commit import"}
        </button>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm text-brand-red-dark">
          <p>{error.message}</p>
          {error.issues && error.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {error.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
