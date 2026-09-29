"use client";

import { useState, useTransition } from "react";
import { setLegacyCoverageAction } from "./actions";

/** PSG confirms the shop's legacy history is loaded before production records can send (AT-08). */
export function LegacyCoverage({ shopId, revision, confirmedAt, canManage }: { shopId: string; revision: number; confirmedAt: string | null; canManage: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(confirmed: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setLegacyCoverageAction(shopId, revision, confirmed);
      if (!result.ok) return setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-700">
        {confirmedAt
          ? `Confirmed ${new Date(confirmedAt).toLocaleString()}. Imported visits are checked against the loaded legacy history.`
          : "Not confirmed. Production records are held until PSG confirms every legacy survey send and completion for this shop is loaded, so no one is surveyed twice."}
      </p>
      {canManage && (
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={() => set(!confirmedAt)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-brand-navy-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : confirmedAt ? "Withdraw confirmation" : "Confirm legacy history is loaded"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-brand-red">
          {error}
        </p>
      )}
    </div>
  );
}
