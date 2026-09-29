"use client";

import { useState, useTransition } from "react";
import type { ShopMode } from "@/modules/shops/settings-policy";
import { MODE_LABELS } from "@/modules/shops/fields";
import { changeModeAction } from "./actions";

export interface ModeOption {
  target: ShopMode;
  issues: string[];
}

export interface LiveSummary {
  deliveryCutoff: string | null;
  versionLabel: string | null;
  timezone: string;
}

const ACTION_LABELS: Record<ShopMode, (from: ShopMode) => string> = {
  live: (from) => (from === "paused" ? "Resume Live" : "Switch to Live"),
  paused: () => "Pause outreach",
  test: () => "Return to Test",
};

const EXPLANATIONS: Record<ShopMode, string> = {
  live: "New eligible imports after this moment may send automatically. Nothing already waiting is sent: you select waiting invitations yourself.",
  paused: "New invitations and reminders stop, including any already queued. Customers who were already invited can still finish their survey.",
  test: "Emails go only to allowlisted internal addresses and records stay out of production reports.",
};

/** Mode changes never send anything by themselves (SR-04); Live needs a confirmed summary. */
export function ModeControl({ shopId, revision, mode, options, summary }: { shopId: string; revision: number; mode: ShopMode; options: ModeOption[]; summary: LiveSummary }) {
  const [selected, setSelected] = useState<ShopMode | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<{ message: string; issues?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(target: ShopMode) {
    setError(null);
    startTransition(async () => {
      const result = await changeModeAction(shopId, revision, target, confirmed);
      if (!result.ok) return setError({ message: result.message, issues: result.issues });
      setSelected(null);
      setConfirmed(false);
    });
  }

  const choice = options.find((o) => o.target === selected);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.target}
            type="button"
            onClick={() => {
              setSelected(o.target);
              setConfirmed(false);
              setError(null);
            }}
            aria-pressed={selected === o.target}
            className={
              selected === o.target
                ? "rounded-lg bg-brand-navy-900 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-brand-navy-700"
            }
          >
            {ACTION_LABELS[o.target](mode)}
          </button>
        ))}
      </div>

      {choice && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm text-gray-700">{EXPLANATIONS[choice.target]}</p>
          {choice.issues.length > 0 ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-gray-900">Before switching to {MODE_LABELS[choice.target]}:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                {choice.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {choice.target === "live" && (
                <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-500">Survey version</dt>
                    <dd className="text-gray-900">{summary.versionLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Delivery cutoff (inclusive)</dt>
                    <dd className="text-gray-900">
                      {summary.deliveryCutoff} <span className="text-gray-500">({summary.timezone})</span>
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500">Waiting invitations</dt>
                    <dd className="text-gray-900">None yet. Imported records that wait for review will be listed here for you to select.</dd>
                  </div>
                </dl>
              )}
              {choice.target === "live" && (
                <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-brand-red" />
                  <span>I have checked this summary. I understand the shop will email customers from eligible new imports.</span>
                </label>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => apply(choice.target)}
                  disabled={pending || (choice.target === "live" && !confirmed)}
                  className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
                >
                  {pending ? "Saving…" : `Confirm: ${ACTION_LABELS[choice.target](mode)}`}
                </button>
                <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm text-brand-red-dark">
          <p>{error.message}</p>
          {error.issues && error.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {error.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
