"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { openAdditionAction, setAdditionAction } from "./actions";

export interface AdditionChoice {
  id: string;
  label: string;
}

/**
 * The shop's own questions (SR-45): shown after the shared survey, never
 * scored. PSG edits and publishes them in the builder, then assigns one
 * published version here; issued invitations keep the one they were sent with.
 */
export function ShopAdditions({
  shopId,
  revision,
  instrumentId,
  assignedId,
  choices,
  canManage,
}: {
  shopId: string;
  revision: number;
  instrumentId: string | null;
  assignedId: string | null;
  choices: AdditionChoice[];
  canManage: boolean;
}) {
  const [selected, setSelected] = useState(assignedId ?? "");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const assigned = choices.find((c) => c.id === assignedId);

  const run = (action: () => Promise<{ ok: true } | { ok: false; message: string }>, success?: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await action();
      if (!result.ok) setMessage({ tone: "error", text: result.message });
      else if (success) setMessage({ tone: "success", text: success });
    });

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-gray-700">{assigned ? `New invitations include ${assigned.label}.` : "None: customers see only the shared PSG survey."}</p>
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          {instrumentId ? (
            <Link href={`/psg/instruments/${instrumentId}`} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:border-brand-navy-700">
              Edit shop questions
            </Link>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => openAdditionAction(shopId))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:border-brand-navy-700 disabled:opacity-50"
            >
              Create shop questions
            </button>
          )}
          {choices.length > 0 && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={`addition-${shopId}`} className="text-xs font-medium text-gray-700">
                  Shop questions for new invitations
                </label>
                <select id={`addition-${shopId}`} value={selected} onChange={(e) => setSelected(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5">
                  <option value="">None</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={pending || selected === (assignedId ?? "")}
                onClick={() => run(() => setAdditionAction(shopId, revision, selected || null), "Saved. Only new invitations use this.")}
                className="rounded-lg bg-brand-navy-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-brand-red" : "text-emerald-800"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
