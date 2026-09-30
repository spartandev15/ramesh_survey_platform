"use client";

import { useActionState, useState } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { createInstrumentAction, type InstrumentFormState } from "./actions";

/** Suggest a survey key from its name, e.g. "Customer Survey 2026" -> "customer_survey_2026". */
function keyFromName(name: string): string {
  const key = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 63);
  return key;
}

/** Create an empty survey, or a copy of `fromVersionId` (SR-44 duplication). */
export function InstrumentForm({ fromVersionId, submitLabel, defaultName = "" }: { fromVersionId?: string; submitLabel: string; defaultName?: string }) {
  const [state, action, pending] = useActionState<InstrumentFormState, FormData>(createInstrumentAction, { ok: false });
  const [name, setName] = useState(state.values?.name ?? defaultName);
  const [key, setKey] = useState(state.values?.key ?? keyFromName(defaultName));
  const [keyTouched, setKeyTouched] = useState(false);

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {state.message && <FormAlert tone="error">{state.message}</FormAlert>}
      {fromVersionId && <input type="hidden" name="fromVersionId" value={fromVersionId} />}
      <TextField
        id={fromVersionId ? "dup-name" : "new-name"}
        name="name"
        label="Survey name"
        placeholder="e.g. Service Experience Survey"
        value={name}
        error={state.fieldErrors?.name}
        onChange={(e) => {
          setName(e.target.value);
          if (!keyTouched) setKey(keyFromName(e.target.value));
        }}
      />
      <TextField
        id={fromVersionId ? "dup-key" : "new-key"}
        name="key"
        label="Survey key"
        placeholder="e.g. service_experience"
        value={key}
        error={state.fieldErrors?.key}
        onChange={(e) => {
          setKeyTouched(true);
          setKey(e.target.value);
        }}
      />
      <p className="-mt-2 text-xs text-gray-500">Permanent ID used in exports and reports. Lowercase letters, numbers and underscores.</p>
      <TextField id={fromVersionId ? "dup-desc" : "new-desc"} name="description" label="Description (optional)" placeholder="A short note for PSG staff" defaultValue={state.values?.description} error={state.fieldErrors?.description} />
      <SubmitButton pending={pending} pendingLabel="Creating…">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
