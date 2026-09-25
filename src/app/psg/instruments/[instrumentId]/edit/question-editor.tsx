"use client";

import { useState } from "react";
import { convertQuestion } from "@/modules/instruments/builder-ops";
import type { Question, QuestionType } from "@/modules/instruments/definition";
import { QUESTION_TYPE_LABELS } from "@/modules/instruments/describe";
import { ConditionEditor } from "./condition-editor";
import { OptionsEditor } from "./options-editor";
import { CheckboxInput, NumberInput, optional, SelectInput, TextInput } from "./ui";

type RequiredMode = "no" | "yes" | "when";

interface QuestionEditorProps {
  question: Question;
  onChange: (question: Question) => void;
  /** Questions before this one; display rules may only use these. */
  earlierQuestions: Question[];
  /** The question existed in the published version this draft is based on. */
  idLocked: boolean;
  lockedOptionIds: string[];
}

export function QuestionEditor({ question: q, onChange, earlierQuestions, idLocked, lockedOptionIds }: QuestionEditorProps) {
  const patch = (fields: Partial<Question>) => onChange({ ...q, ...fields } as Question);
  // "Required only when…" with no clause yet is a UI state; the definition stays optional until a clause exists.
  const [conditional, setConditional] = useState(typeof q.required === "object");
  const requiredMode: RequiredMode = q.required === true ? "yes" : typeof q.required === "object" || conditional ? "when" : "no";

  function setRequiredMode(mode: RequiredMode) {
    setConditional(mode === "when");
    if (mode === "yes") patch({ required: true });
    else if (mode === "no" || typeof q.required !== "object") patch({ required: false });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <TextInput label="Question text" value={q.title} onChange={(title) => patch({ title })} multiline />
        <SelectInput<QuestionType>
          label="Answer type"
          value={q.type}
          options={(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))}
          onChange={(type) => onChange(convertQuestion(q, type))}
        />
      </div>

      <TextInput label="Help text (optional)" value={q.description ?? ""} onChange={(v) => patch({ description: optional(v) })} />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Question ID"
          value={q.id}
          mono
          disabled={idLocked}
          onChange={(id) => patch({ id: id.toLowerCase() })}
          hint={idLocked ? "Fixed: a published version uses this ID, and reports compare by it." : "Stable ID used in exports and reports. Lowercase, numbers, underscores."}
        />
        <TextInput label="Source reference (optional)" value={q.sourceRef ?? ""} onChange={(v) => patch({ sourceRef: optional(v) })} hint="Where this question comes from in the approved source." />
      </div>

      <TypeFields question={q} onChange={onChange} lockedOptionIds={lockedOptionIds} />

      <div className="rounded-lg border border-gray-200 p-4">
        <SelectInput<RequiredMode>
          label="Required"
          value={requiredMode}
          options={[
            { value: "no", label: "Optional" },
            { value: "yes", label: "Always required" },
            { value: "when", label: "Required only when…" },
          ]}
          onChange={setRequiredMode}
        />
        {requiredMode === "when" && (
          <div className="mt-3">
            <ConditionEditor
              label="Required when"
              condition={typeof q.required === "object" ? q.required : undefined}
              onChange={(c) => patch({ required: c ?? false })}
              questions={earlierQuestions}
              emptyText="Add a clause, otherwise the question stays optional."
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <ConditionEditor
          label="Show this question"
          condition={q.visibleWhen}
          onChange={(visibleWhen) => patch({ visibleWhen })}
          questions={earlierQuestions}
          emptyText="Always shown. Add a clause to show it only for certain earlier answers."
        />
      </div>
    </div>
  );
}

function TypeFields({ question: q, onChange, lockedOptionIds }: { question: Question; onChange: (q: Question) => void; lockedOptionIds: string[] }) {
  switch (q.type) {
    case "single_choice":
      return (
        <div className="flex flex-col gap-4">
          <SelectInput
            label="Show options as"
            value={q.display}
            options={[
              { value: "radio", label: "Buttons (all visible)" },
              { value: "dropdown", label: "Dropdown list" },
            ]}
            onChange={(display) => onChange({ ...q, display })}
          />
          <OptionsEditor legend="Options" items={q.choices} onChange={(choices) => onChange({ ...q, choices })} withValue idBase="choice" minItems={2} lockedIds={lockedOptionIds} />
        </div>
      );
    case "multi_choice":
      return (
        <div className="flex flex-col gap-4">
          <OptionsEditor legend="Options" items={q.choices} onChange={(choices) => onChange({ ...q, choices })} withValue={false} idBase="choice" minItems={2} lockedIds={lockedOptionIds} />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberInput label="Minimum selections (optional)" integer min={1} value={q.minSelected} onChange={(minSelected) => onChange({ ...q, minSelected })} />
            <NumberInput label="Maximum selections (optional)" integer min={1} value={q.maxSelected} onChange={(maxSelected) => onChange({ ...q, maxSelected })} />
          </div>
        </div>
      );
    case "rating":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput label="Lowest point" integer value={q.min} onChange={(min) => onChange({ ...q, min: min ?? 0 })} />
          <NumberInput label="Highest point" integer value={q.max} onChange={(max) => onChange({ ...q, max: max ?? 1 })} />
          <TextInput label="Label for lowest (optional)" value={q.minLabel ?? ""} onChange={(v) => onChange({ ...q, minLabel: optional(v) })} />
          <TextInput label="Label for highest (optional)" value={q.maxLabel ?? ""} onChange={(v) => onChange({ ...q, maxLabel: optional(v) })} />
        </div>
      );
    case "number":
      return (
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberInput label="Minimum (optional)" value={q.min} onChange={(min) => onChange({ ...q, min })} />
          <NumberInput label="Maximum (optional)" value={q.max} onChange={(max) => onChange({ ...q, max })} />
          <div className="pt-6">
            <CheckboxInput label="Whole numbers only" checked={q.integer} onChange={(integer) => onChange({ ...q, integer })} />
          </div>
        </div>
      );
    case "text":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput label="Maximum characters" integer min={1} value={q.maxLength} onChange={(maxLength) => onChange({ ...q, maxLength: maxLength ?? 2000 })} />
          <div className="pt-6">
            <CheckboxInput label="Allow multiple lines" checked={q.multiline} onChange={(multiline) => onChange({ ...q, multiline })} />
          </div>
        </div>
      );
    case "matrix":
      return (
        <div className="flex flex-col gap-4">
          <OptionsEditor legend="Rows (each is answered once)" items={q.rows} onChange={(rows) => onChange({ ...q, rows })} withValue={false} idBase="row" minItems={1} lockedIds={lockedOptionIds} />
          <OptionsEditor legend="Answer columns" items={q.columns} onChange={(columns) => onChange({ ...q, columns })} withValue idBase="col" minItems={2} lockedIds={lockedOptionIds} />
        </div>
      );
  }
}
