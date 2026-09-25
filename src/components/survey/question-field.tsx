"use client";

import type { Question } from "@/modules/instruments/definition";
import type { AnswerValue } from "@/modules/instruments/evaluate";

interface QuestionFieldProps {
  question: Question;
  value: AnswerValue | undefined;
  error?: string;
  /** Prefix so the same question can render twice on a page without id clashes. */
  idPrefix: string;
  required: boolean;
  onChange: (value: AnswerValue | undefined) => void;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-brand-navy-700 focus:ring-2 focus:ring-brand-navy-700/20";

/**
 * One survey question with an accessible label or legend, its description and
 * its error (SR-39: labels, keyboard access, errors tied to the field).
 */
export function QuestionField({ question, value, error, idPrefix, required, onChange }: QuestionFieldProps) {
  const id = `${idPrefix}-${question.id}`;
  const describedBy = [question.description ? `${id}-desc` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const heading = (
    <>
      {question.title}
      {required && (
        <span className="ml-1 text-brand-red" aria-hidden="true">
          *
        </span>
      )}
      {required && <span className="sr-only"> (required)</span>}
    </>
  );
  const helpAndError = (
    <>
      {question.description && (
        <p id={`${id}-desc`} className="mt-1 text-sm text-gray-500">
          {question.description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-2 text-sm font-medium text-red-700">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </>
  );

  switch (question.type) {
    case "text":
    case "number":
      return (
        <div>
          <label htmlFor={id} className="block font-medium text-gray-900">
            {heading}
          </label>
          {helpAndError}
          {question.type === "text" && question.multiline ? (
            <textarea
              id={id}
              rows={4}
              maxLength={question.maxLength}
              value={typeof value === "string" ? value : ""}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
              className={`${inputClass} mt-2`}
            />
          ) : (
            <input
              id={id}
              type={question.type === "number" ? "number" : "text"}
              inputMode={question.type === "number" ? "decimal" : undefined}
              min={question.type === "number" ? question.min : undefined}
              max={question.type === "number" ? question.max : undefined}
              step={question.type === "number" && question.integer ? 1 : "any"}
              maxLength={question.type === "text" ? question.maxLength : undefined}
              value={value === undefined ? "" : String(value)}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return onChange(undefined);
                onChange(question.type === "number" ? Number(raw) : raw);
              }}
              className={`${inputClass} mt-2 ${question.type === "number" ? "max-w-48" : ""}`}
            />
          )}
        </div>
      );

    case "single_choice":
      if (question.display === "dropdown") {
        return (
          <div>
            <label htmlFor={id} className="block font-medium text-gray-900">
              {heading}
            </label>
            {helpAndError}
            <select
              id={id}
              value={typeof value === "string" ? value : ""}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.value || undefined)}
              className={`${inputClass} mt-2 max-w-sm`}
            >
              <option value="">Choose one</option>
              {question.choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        );
      }
      return (
        <fieldset aria-describedby={describedBy} aria-invalid={Boolean(error)}>
          <legend className="font-medium text-gray-900">{heading}</legend>
          {helpAndError}
          <div className="mt-3 flex flex-col gap-2">
            {question.choices.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-brand-navy-700 has-[:checked]:border-brand-navy-900 has-[:checked]:bg-brand-navy-900/5">
                <input type="radio" name={id} value={c.id} checked={value === c.id} onChange={() => onChange(c.id)} className="size-4 accent-brand-navy-900" />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      );

    case "multi_choice": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset aria-describedby={describedBy} aria-invalid={Boolean(error)}>
          <legend className="font-medium text-gray-900">{heading}</legend>
          {helpAndError}
          <p className="mt-1 text-xs text-gray-500">Choose all that apply.</p>
          <div className="mt-3 flex flex-col gap-2">
            {question.choices.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:border-brand-navy-700 has-[:checked]:border-brand-navy-900 has-[:checked]:bg-brand-navy-900/5">
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...selected, c.id] : selected.filter((v) => v !== c.id);
                    onChange(next.length ? next : undefined);
                  }}
                  className="size-4 accent-brand-navy-900"
                />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    case "rating": {
      // Guard against a half-edited scale in the builder preview (min above max).
      const points = Array.from({ length: Math.min(101, Math.max(0, question.max - question.min + 1)) }, (_, i) => question.min + i);
      return (
        <fieldset aria-describedby={describedBy} aria-invalid={Boolean(error)}>
          <legend className="font-medium text-gray-900">{heading}</legend>
          {helpAndError}
          <div className="mt-3 flex flex-wrap gap-2">
            {points.map((p) => (
              <label
                key={p}
                className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:border-brand-navy-700 has-[:checked]:border-brand-navy-900 has-[:checked]:bg-brand-navy-900 has-[:checked]:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-red"
              >
                <input type="radio" name={id} value={p} checked={value === p} onChange={() => onChange(p)} className="sr-only" />
                {p}
              </label>
            ))}
          </div>
          {(question.minLabel || question.maxLabel) && (
            <div className="mt-2 flex max-w-xl justify-between gap-4 text-xs text-gray-500">
              <span>
                {question.min} = {question.minLabel ?? question.min}
              </span>
              <span>
                {question.max} = {question.maxLabel ?? question.max}
              </span>
            </div>
          )}
        </fieldset>
      );
    }

    case "matrix": {
      const cells = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
      const setCell = (row: string, column: string) => onChange({ ...cells, [row]: column });
      return (
        <fieldset aria-describedby={describedBy} aria-invalid={Boolean(error)}>
          <legend className="font-medium text-gray-900">{heading}</legend>
          {helpAndError}
          <div className="mt-3 flex flex-col gap-4">
            {question.rows.map((row) => (
              <fieldset key={row.id} className="rounded-lg border border-gray-200 p-3">
                <legend className="px-1 text-sm font-medium text-gray-800">{row.label}</legend>
                <div className="flex flex-wrap gap-2">
                  {question.columns.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:border-brand-navy-700 has-[:checked]:border-brand-navy-900 has-[:checked]:bg-brand-navy-900/5">
                      <input
                        type="radio"
                        name={`${id}-${row.id}`}
                        value={c.id}
                        checked={cells[row.id] === c.id}
                        onChange={() => setCell(row.id, c.id)}
                        className="size-4 accent-brand-navy-900"
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </fieldset>
      );
    }
  }
}
