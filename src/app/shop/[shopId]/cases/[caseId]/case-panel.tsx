"use client";

import { useState, useTransition } from "react";
import { closureAction, shopNoteAction } from "../actions";

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy-700";

/** Shop notes and the closure request. Only PSG can close the case (AT-34). */
export function ShopCasePanel({ shopId, caseId, revision, followUp }: { shopId: string; caseId: string; revision: number; followUp: string }) {
  const [note, setNote] = useState("");
  const [closure, setClosure] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done: () => void) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.message ?? "Could not save.");
      done();
    });

  if (followUp === "resolved") return null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="shop-note" className="text-sm font-medium text-gray-700">
          Add a note for PSG
        </label>
        <textarea id="shop-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        <div>
          <button
            type="button"
            disabled={pending || note.trim().length < 2}
            onClick={() => run(() => shopNoteAction(shopId, caseId, note), () => setNote(""))}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:border-brand-navy-700 disabled:opacity-50"
          >
            Add note
          </button>
        </div>
      </div>
      {followUp === "open" ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-4">
          <label htmlFor="closure" className="text-sm font-medium text-gray-700">
            Handled? Tell PSG what you did
          </label>
          <textarea id="closure" rows={2} value={closure} onChange={(e) => setClosure(e.target.value)} className={field} />
          <div>
            <button
              type="button"
              disabled={pending || closure.trim().length < 5}
              onClick={() => run(() => closureAction(shopId, caseId, revision, closure), () => setClosure(""))}
              className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
            >
              Ask PSG to close this
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-gray-100 pt-4 text-sm text-amber-800">You asked PSG to close this. It stays open until PSG confirms the resolution.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
