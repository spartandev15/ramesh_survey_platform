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
  selected: { id: string; version: number; status: "draft" | "published"; isTest: boolean; sourceNote: string | null };
  hasDraft: boolean;
  /** The number the next version will get. */
  nextVersion: number;
  canManage: boolean;
}

const button =
  "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-navy-700 hover:text-brand-navy-900 disabled:opacity-50";

/** Preview this version as customers see it, edit the open draft, start the next version, move a test version to production, or copy it. */
export function VersionActions({ instrumentId, instrumentName, selected, hasDraft, nextVersion, canManage }: VersionActionsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"duplicate" | "promote" | null>(null);
  const toggle = (name: "duplicate" | "promote") => setPanel((p) => (p === name ? null : name));
  const canPromote = canManage && selected.status === "published" && selected.isTest;

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
              className={button}
            >
              <FilePlus2 aria-hidden="true" className="size-4" /> {pending ? "Creating…" : `New draft from v${selected.version}`}
            </button>
          ))}
        {canPromote && (
          <button type="button" onClick={() => toggle("promote")} aria-expanded={panel === "promote"} className={button}>
            <BadgeCheck aria-hidden="true" className="size-4" /> Move to production
          </button>
        )}
        {canManage && (
          <button type="button" onClick={() => toggle("duplicate")} aria-expanded={panel === "duplicate"} className={button}>
            <Copy aria-hidden="true" className="size-4" /> Duplicate v{selected.version} as a new survey
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {panel === "promote" && canPromote && <PromotePanel instrumentId={instrumentId} selected={selected} hasDraft={hasDraft} nextVersion={nextVersion} onCancel={() => setPanel(null)} />}
      {panel === "duplicate" && (
        <div className="mt-4 max-w-md rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 font-semibold text-brand-navy-900">Duplicate as a new survey</h3>
          <p className="mb-4 text-sm text-gray-600">The copy starts as a draft. This survey and its versions stay unchanged.</p>
          <InstrumentForm fromVersionId={selected.id} submitLabel="Create copy" defaultName={`${instrumentName} copy`} />
        </div>
      )}
    </div>
  );
}

function PromotePanel({
  instrumentId,
  selected,
  hasDraft,
  nextVersion,
  onCancel,
}: {
  instrumentId: string;
  selected: VersionActionsProps["selected"];
  hasDraft: boolean;
  nextVersion: number;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [sourceNote, setSourceNote] = useState(selected.sourceNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function promote(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await promoteAction({ versionId: selected.id, sourceNote });
      if (!result.ok) return setError(result.issues?.[0]?.message ?? result.message);
      router.push(`/psg/instruments/${instrumentId}?version=${result.version}`);
    });
  }

  return (
    <form onSubmit={promote} className="mt-4 max-w-xl rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="font-semibold text-brand-navy-900">Move v{selected.version} to production</h3>
      <p className="mt-2 text-sm text-gray-600">
        The same questions, scoring and alerts are published as the next version, marked as production, so shops in Live mode can use it. Version {selected.version} stays a test version, and its
        test links and test answers stay as they are. Shops keep their current version until you assign the new one in their settings.
      </p>
      {hasDraft ? (
        <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This survey has an open draft. Publish or discard it first.
        </p>
      ) : (
        <>
          <label htmlFor="promote-source" className="mt-4 block text-sm font-medium text-gray-700">
            Approved source (required)
          </label>
          <textarea
            id="promote-source"
            rows={2}
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
            placeholder="e.g. Questions approved by PSG on 2 Nov 2026, from the Alchemer survey 2.2"
            aria-describedby="promote-source-hint"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-navy-700"
          />
          <p id="promote-source-hint" className="mt-1 text-xs text-gray-500">
            Where the approved questions come from. It is saved with the version.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" disabled={pending} aria-busy={pending} className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-60">
              {pending ? "Publishing…" : `Publish as production v${nextVersion}`}
            </button>
            <button type="button" onClick={onCancel} className={button}>
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}
