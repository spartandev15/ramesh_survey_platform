"use client";

import { useState, useTransition } from "react";
import { confirmItemAction, withdrawItemAction } from "./actions";

/** Confirm one launch check with a note, or withdraw it (SR-37). */
export function ItemControl({ shopId, item, label, confirmed }: { shopId: string; item: string; label: string; confirmed: boolean }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `readiness-${shopId}-${item}`;

  const run = (action: () => Promise<{ ok: true } | { ok: false; message: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.message);
      else setNote("");
    });

  return (
    <div className="mt-2 flex flex-col gap-1">
      {confirmed ? (
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => withdrawItemAction(shopId, item))}
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
              What you checked<span className="sr-only"> for {label}</span>
            </label>
            <input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
            />
          </div>
          <button
            type="button"
            disabled={pending || note.trim().length === 0}
            onClick={() => run(() => confirmItemAction(shopId, item, note))}
            // Not "Confirm: …": that name belongs to the mode switch on the same page.
            aria-label={`Record check: ${label}`}
            className="rounded-lg bg-brand-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Record"}
          </button>
        </div>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
