"use client";

import { useActionState, useState } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { slugify } from "@/modules/shops/validation";
import { createShopAction, type CreateShopState } from "./actions";

const US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export function CreateShopForm() {
  const [state, action, pending] = useActionState<CreateShopState, FormData>(createShopAction, { ok: false });
  // Remount the fields after a successful create so the form clears.
  const [formKey, setFormKey] = useState(0);
  const [lastOk, setLastOk] = useState(state);
  if (state !== lastOk) {
    setLastOk(state);
    if (state.ok) setFormKey((k) => k + 1);
  }

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      {state.message && <FormAlert tone={state.ok ? "success" : "error"}>{state.message}</FormAlert>}
      <ShopFields key={formKey} state={state} />
      <SubmitButton pending={pending} pendingLabel="Creating...">
        Create shop
      </SubmitButton>
    </form>
  );
}

function ShopFields({ state }: { state: CreateShopState }) {
  const [slug, setSlug] = useState(state.values?.publicSlug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(state.values?.publicSlug));

  return (
    <>
      <TextField
        id="name"
        name="name"
        label="Shop name"
        defaultValue={state.values?.name}
        error={state.fieldErrors?.name}
        onChange={(e) => {
          if (!slugEdited) setSlug(slugify(e.target.value));
        }}
      />
      <TextField
        id="publicSlug"
        name="publicSlug"
        label="Public link name"
        value={slug}
        error={state.fieldErrors?.publicSlug}
        onChange={(e) => {
          setSlugEdited(true);
          setSlug(e.target.value);
        }}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="timezone" className="text-sm font-medium text-gray-700">
          Timezone
        </label>
        <select
          id="timezone"
          name="timezone"
          defaultValue={state.values?.timezone ?? "America/New_York"}
          className="rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm"
        >
          {US_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" name="isTestShop" defaultChecked={state.values?.isTestShop} className="mt-0.5 size-4 accent-brand-red" />
        <span>
          Internal test shop
          <span className="block text-xs text-gray-500">Test shop data never appears in production reports.</span>
        </span>
      </label>
    </>
  );
}
