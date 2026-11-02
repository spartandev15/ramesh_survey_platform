"use client";

import { BadgeCheck, Copy, Eye, FilePlus2, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createDraftFromAction, promoteAction } from "../actions";
import { InstrumentForm } from "../instrument-form";

interface VersionActionsProps {
  instrumentId: string;
  instrumentName: string;
  selected: { id: string; version: number; status: "draft" | "published"; isTest: boolean };
  hasDraft: boolean;
  canManage: boolean;
}

const button =
  "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-navy-700 hover:text-brand-navy-900 disabled:opacity-50";

/** Preview this version as customers see it, edit the open draft, start the next version, move a test version to production, or copy it. */
export function VersionActions({ instrumentId, instrumentName, selected, hasDraft, canManage }: VersionActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [promoting, startPromote] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const production = selected.status === "published" && !selected.isTest;

  function promote() {
    setError(null);
    startPromote(async () => {
      const result = await promoteAction({ versionId: selected.id });
      if (!result.ok) return setError(result.message);
      router.push(`/psg/instruments/${instrumentId}?version=${result.version}`);
    });
  }

  return (
    <div className="mt-4">
      <div data-tour="version-actions" className="flex flex-wrap gap-2">
        <a href={`/survey-preview/${instrumentId}?version=${selected.version}`} target="_blank" rel="noopener" className={button}>
          <Eye aria-hidden="true" className="size-4" /> Preview survey
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {canManage &&
          (hasDraft ? (
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
              // A production version stays as it is; its draft copy is where the changes go.
              title={production ? `Opens an editable copy of v${selected.version}; v${selected.version} stays as it is` : undefined}
              className={button}
            >
              <FilePlus2 aria-hidden="true" className="size-4" /> {pending ? "Creating…" : production ? "Move to draft" : `New draft from v${selected.version}`}
            </button>
          ))}
        {canManage && selected.status === "published" && selected.isTest && (
          <button type="button" onClick={promote} disabled={promoting} aria-busy={promoting} className={button}>
            <BadgeCheck aria-hidden="true" className="size-4" /> {promoting ? "Moving…" : "Move to production"}
          </button>
        )}
        {canManage && (
          <button type="button" onClick={() => setDuplicating((d) => !d)} aria-expanded={duplicating} className={button}>
            <Copy aria-hidden="true" className="size-4" /> Duplicate v{selected.version} as a new survey
          </button>
        )}
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
