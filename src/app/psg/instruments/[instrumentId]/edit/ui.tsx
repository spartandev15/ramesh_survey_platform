"use client";

import { useId } from "react";

const inputBase =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-brand-navy-700 focus:ring-2 focus:ring-brand-navy-700/20 disabled:bg-gray-50 disabled:text-gray-500";

export const inputClass = `w-full ${inputBase}`;
/** For inline controls that size to their content (condition clauses, weights). */
export const compactInputClass = inputBase;

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-red-dark disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-navy-700 hover:text-brand-navy-900 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 hover:text-brand-navy-900 disabled:cursor-not-allowed disabled:opacity-40",
  danger:
    "inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-sm text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40",
};

export function TextInput({
  label,
  value,
  onChange,
  hint,
  disabled,
  multiline,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  disabled?: boolean;
  multiline?: boolean;
  mono?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const cls = `${inputClass} mt-1 ${mono ? "font-mono text-xs" : ""}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} rows={2} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input id={id} type="text" value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** Number field that allows an empty value (`undefined`). */
export function NumberInput({
  label,
  value,
  onChange,
  hint,
  integer,
  min,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  hint?: string;
  integer?: boolean;
  min?: number;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type="number"
        step={integer ? 1 : "any"}
        min={min}
        value={value === undefined || Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className={`${inputClass} mt-1`}
      />
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function SelectInput<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  hideLabel,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "block text-sm font-medium text-gray-700"}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={`${inputClass} ${hideLabel ? "" : "mt-1"}`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function CheckboxInput({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center gap-2">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-brand-navy-900" />
        <label htmlFor={id} className="text-sm text-gray-700">
          {label}
        </label>
      </div>
      {hint && <p className="ml-6 mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** Empty string to undefined, so optional text fields are omitted rather than stored blank. */
export function optional(value: string): string | undefined {
  return value.trim() === "" ? undefined : value;
}
