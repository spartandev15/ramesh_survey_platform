import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
}

/**
 * Labelled input with an error message linked for screen readers and marked
 * with text, not colour alone (SR-39, AT-39).
 */
export function TextField({ id, label, error, className, ...input }: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`rounded-lg border px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-navy-700 disabled:bg-gray-50 ${
          error ? "border-brand-red" : "border-gray-300"
        } ${className ?? ""}`}
        {...input}
      />
      {error && (
        <p id={errorId} className="text-sm text-brand-red">
          <span className="font-semibold">Error: </span>
          {error}
        </p>
      )}
    </div>
  );
}
