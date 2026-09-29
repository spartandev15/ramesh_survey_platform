"use client";

import { useState, useTransition } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { ShopHeader } from "@/app/survey/shop-header";
import { US_TIMEZONES } from "@/modules/shops/fields";
import { saveSettingsAction, type SettingsFormValues } from "./actions";

export interface VersionChoice {
  id: string;
  label: string;
  isTest: boolean;
}

const field = "w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-navy-700 disabled:bg-gray-50";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-brand-red">
          <span className="font-semibold">Error: </span>
          {error}
        </p>
      )}
    </div>
  );
}

/** Cutoff, assigned version, timing, alert recipients and branding (SR-02, SR-05). */
export function SettingsForm({
  shopId,
  shopName,
  revision,
  initial,
  versions,
  suggestedCutoff,
  canManage,
}: {
  shopId: string;
  shopName: string;
  revision: number;
  initial: SettingsFormValues;
  versions: VersionChoice[];
  suggestedCutoff: string;
  canManage: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string; issues?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof SettingsFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const aria = (key: string, hint = false) => ({
    "aria-invalid": fieldErrors[key] ? true : undefined,
    "aria-describedby": [hint ? `${key}-hint` : "", fieldErrors[key] ? `${key}-error` : ""].filter(Boolean).join(" ") || undefined,
    className: `${field} ${fieldErrors[key] ? "border-brand-red" : "border-gray-300"}`,
    disabled: !canManage,
  });

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveSettingsAction(shopId, revision, values);
      if (result.ok) {
        setFieldErrors({});
        setMessage({ tone: "success", text: "Settings saved." });
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setMessage({ tone: "error", text: result.message, issues: result.issues });
    });
  }

  const timezones = US_TIMEZONES.includes(values.timezone) ? US_TIMEZONES : [values.timezone, ...US_TIMEZONES];
  const selectedVersion = versions.find((v) => v.id === values.instrumentVersionId);

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6">
      {message && (
        <FormAlert tone={message.tone}>
          <p>{message.text}</p>
          {message.issues && message.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {message.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </FormAlert>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-base font-semibold text-brand-navy-900">Survey and eligibility</legend>
        <div className="sm:col-span-2">
          <Field
            id="instrumentVersionId"
            label="Survey version for new invitations"
            hint="Changing it affects only invitations issued from now on. Surveys already sent keep their own version. To roll back, choose an earlier version."
            error={fieldErrors.instrumentVersionId}
          >
            <select id="instrumentVersionId" value={values.instrumentVersionId} onChange={set("instrumentVersionId")} {...aria("instrumentVersionId", true)}>
              <option value="">Not assigned</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          {selectedVersion?.isTest && <p className="mt-1.5 text-xs text-amber-800">This is a TEST version. It can be used only while the shop is in Test mode.</p>}
        </div>
        <Field
          id="deliveryCutoff"
          label="Delivery cutoff date (inclusive)"
          hint="Vehicles delivered on or after this date qualify. Moving it earlier sends nothing: newly eligible records wait for your review."
          error={fieldErrors.deliveryCutoff}
        >
          <div className="flex gap-2">
            <input id="deliveryCutoff" type="date" value={values.deliveryCutoff} onChange={set("deliveryCutoff")} {...aria("deliveryCutoff", true)} />
            {canManage && !values.deliveryCutoff && (
              <button
                type="button"
                onClick={() => setValues((v) => ({ ...v, deliveryCutoff: suggestedCutoff }))}
                className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:border-brand-navy-700"
              >
                Use today
              </button>
            )}
          </div>
        </Field>
        <Field id="timezone" label="Shop timezone" hint="Delivery dates and the cutoff use this shop's local calendar." error={fieldErrors.timezone}>
          <select id="timezone" value={values.timezone} onChange={set("timezone")} {...aria("timezone", true)}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
        <Field id="reminderDelayDays" label="Reminder delay (days)" hint="One reminder, sent this many days after the invitation is accepted." error={fieldErrors.reminderDelayDays}>
          <input id="reminderDelayDays" type="number" min={1} max={60} value={values.reminderDelayDays} onChange={set("reminderDelayDays")} {...aria("reminderDelayDays", true)} />
        </Field>
        <Field id="linkLifetimeDays" label="Survey link lifetime (days)" hint="How long a customer's link stays open." error={fieldErrors.linkLifetimeDays}>
          <input id="linkLifetimeDays" type="number" min={1} max={365} value={values.linkLifetimeDays} onChange={set("linkLifetimeDays")} {...aria("linkLifetimeDays", true)} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="alertRecipients" label="Negative alert recipients" hint="One email address per line. Alerts are sent only after PSG approves them." error={fieldErrors.alertRecipients}>
            <textarea id="alertRecipients" rows={3} value={values.alertRecipients} onChange={set("alertRecipients")} {...aria("alertRecipients", true)} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-base font-semibold text-brand-navy-900">Branding</legend>
        <div className="sm:col-span-2">
          <Field id="logoUrl" label="Approved logo link" hint="An https:// image link. If it fails to load, the survey shows the shop name instead." error={fieldErrors.logoUrl}>
            <input id="logoUrl" type="url" value={values.logoUrl} onChange={set("logoUrl")} placeholder="https://" {...aria("logoUrl", true)} />
          </Field>
        </div>
        <Field id="brandColor" label="Brand colour" hint="Header colour on the survey, like #001c3d. Text colour adjusts for contrast." error={fieldErrors.brandColor}>
          <div className="flex gap-2">
            <input id="brandColor" value={values.brandColor} onChange={set("brandColor")} placeholder="#001c3d" {...aria("brandColor", true)} />
            <input
              type="color"
              aria-label="Pick brand colour"
              value={/^#[0-9a-f]{6}$/i.test(values.brandColor) ? values.brandColor : "#001c3d"}
              onChange={set("brandColor")}
              disabled={!canManage}
              className="h-10 w-12 shrink-0 cursor-pointer rounded border border-gray-300 bg-white"
            />
          </div>
        </Field>
        <div className="sm:col-span-2">
          <p className="text-sm font-medium text-gray-700">Preview</p>
          <div className="mt-1.5 overflow-hidden rounded-lg border border-gray-200">
            <ShopHeader key={values.logoUrl} name={shopName} logoUrl={values.logoUrl || null} brandColor={values.brandColor || null} />
          </div>
        </div>
      </fieldset>

      {canManage && (
        <div>
          <button type="submit" disabled={pending} aria-busy={pending} className="rounded-lg bg-brand-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-60">
            {pending ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}
    </form>
  );
}
