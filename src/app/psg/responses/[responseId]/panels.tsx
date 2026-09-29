"use client";

import { useState, useTransition } from "react";
import { AnswerSheet, submissionErrors } from "@/components/survey/answer-sheet";
import type { InstrumentDefinition } from "@/modules/instruments/definition";
import type { Answers } from "@/modules/instruments/evaluate";
import type { CandidateVisit } from "@/modules/responses/staff-store";
import { candidateVisitsAction, confirmShopAction, correctAction, duplicateAction, matchAction, unresolvedAction } from "../actions";

const field = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy-700";
const primary = "rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50";
const secondary = "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:border-brand-navy-700 disabled:opacity-50";

function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-brand-red">
      {message}
    </p>
  ) : null;
}

/** Match a known-shop response to a visit, from evidence (SR-28). */
export function MatchPanel({ responseId, matchRevision, initial }: { responseId: string; matchRevision: number; initial: CandidateVisit[] }) {
  const [candidates, setCandidates] = useState(initial);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = candidates.find((c) => c.visitId === chosen);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(result.message ?? "Could not save.");
    });

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => setCandidates(await candidateVisitsAction(responseId, search)));
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="match-search" className="text-sm font-medium text-gray-700">
            Search this shop&apos;s visits
          </label>
          <input id="match-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Visit ID, repair order, last name" className={`${field} w-72 max-w-full`} />
        </div>
        <button type="submit" disabled={pending} className={secondary}>
          Search
        </button>
      </form>

      {candidates.length === 0 ? (
        <p className="text-sm text-gray-600">No suggested visits. Search above, or record what you checked.</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-gray-700">Possible visits and why</legend>
          {candidates.map((c) => (
            <label key={c.visitId} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${chosen === c.visitId ? "border-brand-navy-700 bg-brand-navy-900/5" : "border-gray-200"}`}>
              <input type="radio" name="visit" checked={chosen === c.visitId} onChange={() => setChosen(c.visitId)} className="mt-1 accent-brand-red" />
              <span>
                <span className="font-mono">{c.sourceVisitKey}</span> · {c.customerName}
                {c.deliveredOn ? ` · delivered ${c.deliveredOn}` : ""}
                <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">
                  {c.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
                {c.hasCountedResponse && <span className="mt-1 block text-xs text-amber-800">This visit already has a counted response: matching sends this one to duplicate review.</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="match-note" className="text-sm font-medium text-gray-700">
          Evidence or note
        </label>
        <input id="match-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. RO number and last name match the shop record" className={field} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !selected} onClick={() => run(() => matchAction(responseId, matchRevision, selected!.visitId, note || selected!.evidence.join("; ")))} className={primary}>
          Match to selected visit
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => unresolvedAction(responseId, matchRevision, note))} className={secondary}>
          Record as still unmatched
        </button>
      </div>
      <ErrorText message={error} />
    </div>
  );
}

/** Confirm the shop for a PSG-only response (SR-29). */
export function ShopPanel({ responseId, matchRevision, suggestions, shops }: { responseId: string; matchRevision: number; suggestions: { shopId: string; shopName: string; evidence: string }[]; shops: { id: string; name: string }[] }) {
  const [shopId, setShopId] = useState(suggestions[0]?.shopId ?? "");
  const [evidence, setEvidence] = useState(suggestions[0]?.evidence ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {suggestions.length > 0 ? (
        <ul className="flex flex-col gap-2 text-sm">
          {suggestions.map((s) => (
            <li key={s.shopId} className="rounded-lg border border-gray-200 p-3">
              <span className="font-medium text-gray-900">Suggested: {s.shopName}</span>
              <span className="block text-xs text-gray-600">{s.evidence}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-600">No suggestions. Choose the shop only if the source clearly shows it.</p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="confirm-shop" className="text-sm font-medium text-gray-700">
            Shop
          </label>
          <select id="confirm-shop" value={shopId} onChange={(e) => setShopId(e.target.value)} className={`${field} w-72 max-w-full`}>
            <option value="">Choose a shop</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <label htmlFor="confirm-evidence" className="text-sm font-medium text-gray-700">
            Evidence
          </label>
          <input id="confirm-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} className={field} />
        </div>
      </div>
      <div>
        <button
          type="button"
          disabled={pending || !shopId}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await confirmShopAction(responseId, matchRevision, shopId, evidence);
              if (!result.ok) return setError(result.message);
            })
          }
          className={primary}
        >
          Confirm shop
        </button>
      </div>
      <p className="text-xs text-gray-500">The shop cannot see this response until you confirm. Matching the visit is a separate step.</p>
      <ErrorText message={error} />
    </div>
  );
}

/** Decide which response counts for a visit (SR-19). */
export function DuplicatePanel({ responseId, matchRevision }: { responseId: string; matchRevision: number }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (disposition: "keep_original" | "promote") =>
    startTransition(async () => {
      setError(null);
      const result = await duplicateAction(responseId, matchRevision, disposition, note);
      if (!result.ok) return setError(result.message);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="dup-note" className="text-sm font-medium text-gray-700">
          Reason (required)
        </label>
        <input id="dup-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Same customer; the online answers came first" className={field} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => decide("keep_original")} className={secondary}>
          Keep the counted response
        </button>
        <button type="button" disabled={pending} onClick={() => decide("promote")} className={primary}>
          Count this response instead
        </button>
      </div>
      <p className="text-xs text-gray-500">Either way both responses are kept. Only one ever counts for the visit.</p>
      <ErrorText message={error} />
    </div>
  );
}

/** Audited correction: appends a revision, keeps the original (SR-20). */
export function CorrectionPanel({ responseId, revision, definition, answers }: { responseId: string; revision: number; definition: InstrumentDefinition; answers: Answers }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Answers>(answers);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {message && (
          <p role="status" className="text-sm text-green-800">
            {message.text}
          </p>
        )}
        <div>
          <button type="button" onClick={() => setOpen(true)} className={secondary}>
            Correct answers
          </button>
        </div>
      </div>
    );
  }

  function save() {
    const problems = submissionErrors(definition, draft);
    if (problems.size > 0) {
      setErrors(problems);
      return setMessage({ tone: "error", text: "Some answers need attention." });
    }
    startTransition(async () => {
      const result = await correctAction(responseId, revision, draft, reason);
      if (!result.ok) {
        if (result.errors?.length) setErrors(new Map(result.errors.map((x) => [x.questionId, x.message])));
        return setMessage({ tone: "error", text: result.message });
      }
      setOpen(false);
      setMessage({ tone: "success", text: result.alertsChanged ? "Correction saved. The alert outcome changed: review it before any outreach." : "Correction saved as a new revision." });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">The original answers are kept. Your correction is saved as a new revision with your name and reason, and the scores are recalculated.</p>
      <AnswerSheet definition={definition} answers={draft} onChange={setDraft} errors={errors} idPrefix="correct" />
      <div className="flex flex-col gap-1">
        <label htmlFor="correct-reason" className="text-sm font-medium text-gray-700">
          Reason for the correction (required)
        </label>
        <input id="correct-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
      </div>
      {message?.tone === "error" && (
        <p role="alert" className="text-sm text-brand-red">
          {message.text}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={save} className={primary}>
          {pending ? "Saving…" : "Save correction"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setDraft(answers);
          }}
          className={secondary}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
