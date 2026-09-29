"use client";

import { useState, useTransition } from "react";
import type { Resolution } from "@/modules/email-ledger/store";
import { resolveEmailAction } from "./actions";

const OPTIONS: Record<string, { value: Resolution; label: string; needsNote: boolean }[]> = {
  held: [{ value: "release", label: "Release to send", needsNote: false }],
  acceptance_unknown: [
    { value: "confirm_sent", label: "Provider shows it was sent", needsNote: true },
    { value: "confirm_not_sent", label: "Provider has no record: send it", needsNote: true },
  ],
  failed: [{ value: "retry", label: "Try again", needsNote: false }],
};

/**
 * PSG settles one email. An unknown outcome needs the provider evidence noted,
 * because sending again could email the customer twice (AT-23).
 */
export function ResolveControls({ intentId, state }: { intentId: string; state: string }) {
  const options = OPTIONS[state] ?? [];
  const [choice, setChoice] = useState<Resolution | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (options.length === 0) return <span className="text-xs text-gray-500">No action: the provider reported it could not deliver.</span>;
  const selected = options.find((o) => o.value === choice);

  function confirm(resolution: Resolution) {
    startTransition(async () => {
      setError(null);
      const result = await resolveEmailAction(intentId, resolution, note);
      if (!result.ok) return setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={choice === o.value}
            onClick={() => setChoice(o.value)}
            className={
              choice === o.value
                ? "rounded-lg bg-brand-navy-900 px-3 py-1.5 text-xs font-medium text-white"
                : "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-brand-navy-700"
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      {selected && (
        <div className="flex flex-wrap items-end gap-2">
          {selected.needsNote && (
            <div className="flex min-w-60 flex-1 flex-col gap-1">
              <label htmlFor={`note-${intentId}`} className="text-xs font-medium text-gray-700">
                Provider evidence you checked
              </label>
              <input
                id={`note-${intentId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. SendGrid activity search, message not found"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
          )}
          <button type="button" disabled={pending} onClick={() => confirm(selected.value)} className="rounded-lg bg-brand-red px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {pending ? "Saving…" : "Confirm"}
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
