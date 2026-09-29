"use client";

import { useState, useTransition } from "react";
import { approveAction, dismissAction, psgNoteAction, resolveAction } from "../actions";

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy-700";
const primary = "rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50";
const secondary = "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:border-brand-navy-700 disabled:opacity-50";

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, onDone?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(result.message ?? "Could not save.");
      onDone?.();
    });
  return { error, pending, run };
}

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-brand-red">
      {message}
    </p>
  ) : null;
}

/**
 * Review a case: Approve & Send to an adjustable recipient list, or dismiss.
 * Editing the list here does not change the shop's saved recipients (AT-33).
 */
export function ReviewPanel({ caseId, revision, savedRecipients, canReview, shopConfirmed }: { caseId: string; revision: number; savedRecipients: string[]; canReview: boolean; shopConfirmed: boolean }) {
  const [recipients, setRecipients] = useState(savedRecipients.join("\n"));
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { error, pending, run } = useAction();
  const list = recipients.split(/[\s,;]+/).filter(Boolean);

  if (!canReview) return <p className="text-sm text-gray-600">Only alert reviewers can approve or dismiss.</p>;
  if (!shopConfirmed) return <p className="text-sm text-amber-800">Confirm the response&apos;s shop on its response page before any outreach.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="recipients" className="text-sm font-medium text-gray-700">
          Send to (one email per line)
        </label>
        <textarea id="recipients" rows={3} value={recipients} onChange={(e) => setRecipients(e.target.value)} className={field} />
        <p className="text-xs text-gray-500">Starts from the shop&apos;s saved list. Changes here apply to this alert only.</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="review-note" className="text-sm font-medium text-gray-700">
          Review note (kept in PSG history)
        </label>
        <input id="review-note" value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </div>
      {!confirming ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending || list.length === 0} onClick={() => setConfirming(true)} className={primary}>
            Approve &amp; Send
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => dismissAction(caseId, revision, note))} className={secondary}>
            Dismiss: no outreach needed
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
          Email this alert to {list.length} recipient{list.length === 1 ? "" : "s"} now?
          <button type="button" disabled={pending} onClick={() => run(() => approveAction(caseId, revision, list, note), () => setConfirming(false))} className={primary}>
            {pending ? "Sending…" : "Yes, approve and send"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={secondary}>
            Cancel
          </button>
        </div>
      )}
      <ErrorText message={error} />
    </div>
  );
}

export function NoteForm({ caseId }: { caseId: string }) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"shop" | "internal">("internal");
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="note-body" className="text-sm font-medium text-gray-700">
        Add a note
      </label>
      <textarea id="note-body" rows={2} value={body} onChange={(e) => setBody(e.target.value)} className={field} />
      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="flex gap-3 text-sm text-gray-700">
          <legend className="sr-only">Who can see this note</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="visibility" checked={visibility === "internal"} onChange={() => setVisibility("internal")} className="accent-brand-red" /> PSG only
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="visibility" checked={visibility === "shop"} onChange={() => setVisibility("shop")} className="accent-brand-red" /> Shared with the shop
          </label>
        </fieldset>
        <button type="button" disabled={pending || body.trim().length < 2} onClick={() => run(() => psgNoteAction(caseId, body, visibility), () => setBody(""))} className={secondary}>
          Add note
        </button>
      </div>
      <ErrorText message={error} />
    </div>
  );
}

export function ResolvePanel({ caseId, revision, outcomes }: { caseId: string; revision: number; outcomes: [string, string][] }) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="outcome" className="text-sm font-medium text-gray-700">
            Outcome
          </label>
          <select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={`${field} w-72`}>
            <option value="">Choose the outcome</option>
            {outcomes.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <label htmlFor="resolve-note" className="text-sm font-medium text-gray-700">
            Note for the shop (optional)
          </label>
          <input id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </div>
      </div>
      <div>
        <button type="button" disabled={pending || !outcome} onClick={() => run(() => resolveAction(caseId, revision, outcome as never, note))} className={primary}>
          Confirm resolution
        </button>
      </div>
      <ErrorText message={error} />
    </div>
  );
}
