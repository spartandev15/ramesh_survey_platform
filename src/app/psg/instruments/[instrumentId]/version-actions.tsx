"use client";

import { Copy, FilePlus2, Pencil } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { createDraftFromAction } from "../actions";
import { InstrumentForm } from "../instrument-form";

interface VersionActionsProps {
  instrumentId: string;
  instrumentName: string;
  selected: { id: string; version: number; status: "draft" | "published" };
  hasDraft: boolean;
}

/** Edit the open draft, start the next version, or copy this version into a new survey. */
export function VersionActions({ instrumentId, instrumentName, selected, hasDraft }: VersionActionsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const button =
    "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-navy-700 hover:text-brand-navy-900 disabled:opacity-50";

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {hasDraft ? (
          <Link href={`/psg/instruments/${instrumentId}/edit`} className="inline-flex items-center gap-2 rounded-lg bg-brand-red px-3 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark">
            <Pencil aria-hidden="true" className="size-4" /> Edit draft
          </Link>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await createDraftFromAction(selected.id);
                if (result && !result.ok) setError(result.message);
              })
            }
            className={button}
          >
            <FilePlus2 aria-hidden="true" className="size-4" /> {pending ? "Creating…" : `New draft from v${selected.version}`}
          </button>
        )}
        <button type="button" onClick={() => setDuplicating((d) => !d)} aria-expanded={duplicating} className={button}>
          <Copy aria-hidden="true" className="size-4" /> Duplicate v{selected.version} as a new survey
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {duplicating && (
        <div className="mt-4 max-w-md rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 font-semibold text-brand-navy-900">Duplicate as a new survey</h3>
          <p className="mb-4 text-sm text-gray-600">The copy starts as a draft. This survey and its versions stay unchanged.</p>
          <InstrumentForm fromVersionId={selected.id} submitLabel="Create copy" defaultName={`${instrumentName} copy`} />
        </div>
      )}
    </div>
  );
}
