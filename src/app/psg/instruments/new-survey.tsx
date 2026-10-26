"use client";

import { useState } from "react";
import { InstrumentForm } from "./instrument-form";

export interface CopySource {
  id: string;
  name: string;
  shopQuestions: boolean;
  versions: { id: string; label: string }[];
  /** Latest published version, else the newest one. */
  defaultVersionId: string;
}

const SELECT = "h-10 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-indigo-400";

/** Start a blank survey, or copy any version of an existing one (SR-44 duplication). */
export function NewSurvey({ sources }: { sources: CopySource[] }) {
  const [mode, setMode] = useState<"blank" | "copy">("blank");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const source = sources.find((s) => s.id === sourceId);
  const [versionId, setVersionId] = useState(source?.defaultVersionId ?? "");

  const tab = (value: "blank" | "copy", label: string) => (
    <label className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-400 ${mode === value ? "bg-white text-brand-navy-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>
      <input type="radio" name="new-survey-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
      {label}
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="sr-only">Start from</legend>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {tab("blank", "Blank survey")}
          {tab("copy", "Copy a survey")}
        </div>
      </fieldset>

      {mode === "blank" && <InstrumentForm submitLabel="Create survey" />}

      {mode === "copy" &&
        (source ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="copy-source" className="text-sm font-medium text-gray-800">
                Survey to copy
              </label>
              <select
                id="copy-source"
                value={sourceId}
                onChange={(e) => {
                  const next = sources.find((s) => s.id === e.target.value);
                  setSourceId(e.target.value);
                  setVersionId(next?.defaultVersionId ?? "");
                }}
                className={SELECT}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.shopQuestions ? " (shop questions)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="copy-version" className="text-sm font-medium text-gray-800">
                Version
              </label>
              <select id="copy-version" value={versionId} onChange={(e) => setVersionId(e.target.value)} className={SELECT}>
                {source.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="-mt-1 text-xs text-gray-500">Copies the questions, conditions, scoring, alert and suppression rules into a new draft. Responses, links and the original survey stay as they are.</p>
            {/* A new key per source resets the suggested name when the source changes. */}
            <InstrumentForm key={sourceId} fromVersionId={versionId} submitLabel="Create copy" defaultName={`${source.name} copy`} />
          </>
        ) : (
          <p className="text-sm text-gray-500">There is no survey to copy yet.</p>
        ))}
    </div>
  );
}
