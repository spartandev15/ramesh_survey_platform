"use client";

import { useState, useTransition } from "react";
import { assignOwnerAction, reviewItemAction } from "./actions";

// The actions call revalidatePath, which returns the refreshed page in the same response, so no router.refresh().

/** Name who owns one queue item (SR-38). Saving checks the item did not change meanwhile. */
export function OwnerControl({
  subjectType,
  subjectId,
  revision,
  ownerUserId,
  operators,
  currentUserId,
  itemTitle,
  stacked = false,
}: {
  subjectType: string;
  subjectId: string;
  revision: number;
  ownerUserId: string | null;
  operators: { userId: string; name: string }[];
  currentUserId: string;
  itemTitle: string;
  /** Label above, "Take it" below: for the narrow owner column of the queue list. */
  stacked?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `owner-${subjectType}-${subjectId}`;

  function save(next: string | null) {
    startTransition(async () => {
      setError(null);
      const result = await assignOwnerAction(subjectType, subjectId, next, revision);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className={stacked ? "flex flex-col items-start gap-1.5" : "flex flex-wrap items-center gap-3"}>
        <label htmlFor={id} className={stacked ? "text-xs text-gray-500" : "text-sm font-medium text-gray-700"}>
          Owner<span className="sr-only"> of {itemTitle}</span>
        </label>
        <select
          id={id}
          value={ownerUserId ?? ""}
          disabled={pending}
          onChange={(e) => save(e.target.value || null)}
          className={`max-w-56 rounded-lg border border-gray-200 bg-white text-gray-800 shadow-sm disabled:opacity-50 ${stacked ? "w-36 px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"}`}
        >
          <option value="">Nobody yet</option>
          {operators.map((o) => (
            <option key={o.userId} value={o.userId}>
              {o.name}
            </option>
          ))}
        </select>
        {ownerUserId !== currentUserId && (
          <button
            type="button"
            disabled={pending}
            onClick={() => save(currentUserId)}
            aria-label={`Take ownership of ${itemTitle}`}
            className={`rounded-lg border border-gray-200 bg-white font-medium text-gray-700 shadow-sm transition hover:border-gray-400 disabled:opacity-50 ${stacked ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm"}`}
          >
            Take it
          </button>
        )}
        {pending && <span className="text-xs text-gray-500">Saving…</span>}
      </div>
      {error && (
        <p role="alert" className="text-xs text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}

const PLACEHOLDERS: Record<string, string> = {
  worker_job: "e.g. Database restart; the next cycle ran fine",
  import_row: "e.g. Shop sent the RO number; re-imported in the next file",
};

/** Record what was checked or fixed for a failed job or an import row, which takes it off the queue. */
export function ReviewForm({ subjectType, subjectId, revision }: { subjectType: string; subjectId: string; revision: number }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `review-${subjectType}-${subjectId}`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label htmlFor={id} className="text-xs font-medium text-gray-700">
            What you checked or fixed
          </label>
          <input
            id={id}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={error ? true : undefined}
            placeholder={PLACEHOLDERS[subjectType]}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
          />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await reviewItemAction(subjectType, subjectId, revision, note);
              if (!result.ok) setError(result.message);
            })
          }
          className="rounded-lg bg-brand-navy-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Mark reviewed"}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
