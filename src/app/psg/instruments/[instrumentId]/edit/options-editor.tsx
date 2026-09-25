"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { moveItem, uniqueId } from "@/modules/instruments/builder-ops";
import { buttonClass, inputClass } from "./ui";

export interface OptionItem {
  id: string;
  label: string;
  value?: number;
}

/**
 * Editable list of options (choices, matrix columns) or matrix rows.
 * `withValue` shows the scoring value; an empty value means "not scored".
 */
export function OptionsEditor<T extends OptionItem>({
  legend,
  items,
  onChange,
  withValue,
  idBase,
  lockedIds = [],
  minItems,
}: {
  legend: string;
  items: T[];
  onChange: (items: T[]) => void;
  withValue: boolean;
  idBase: string;
  lockedIds?: string[];
  minItems: number;
}) {
  const set = (index: number, patch: Partial<OptionItem>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const locked = new Set(lockedIds);

  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700">{legend}</legend>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th scope="col" className="pb-1 pr-2 font-medium">Label</th>
              <th scope="col" className="pb-1 pr-2 font-medium">ID</th>
              {withValue && <th scope="col" className="pb-1 pr-2 font-medium">Score value</th>}
              <th scope="col" className="pb-1 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index}>
                <td className="py-1 pr-2">
                  <input aria-label={`Label ${index + 1}`} value={item.label} onChange={(e) => set(index, { label: e.target.value })} className={`${inputClass} py-1.5`} />
                </td>
                <td className="w-40 py-1 pr-2">
                  <input
                    aria-label={`ID ${index + 1}`}
                    value={item.id}
                    disabled={locked.has(item.id)}
                    title={locked.has(item.id) ? "Used by a published version, so the ID stays fixed" : undefined}
                    onChange={(e) => set(index, { id: e.target.value.toLowerCase() })}
                    className={`${inputClass} py-1.5 font-mono text-xs`}
                  />
                </td>
                {withValue && (
                  <td className="w-28 py-1 pr-2">
                    <input
                      aria-label={`Score value ${index + 1}`}
                      type="number"
                      step="any"
                      placeholder="Not scored"
                      value={item.value ?? ""}
                      onChange={(e) => set(index, { value: e.target.value === "" ? undefined : Number(e.target.value) })}
                      className={`${inputClass} py-1.5`}
                    />
                  </td>
                )}
                <td className="whitespace-nowrap py-1">
                  <button type="button" aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => onChange(moveItem(items, index, index - 1))} className={buttonClass.ghost}>
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} down`}
                    disabled={index === items.length - 1}
                    onClick={() => onChange(moveItem(items, index, index + 1))}
                    className={buttonClass.ghost}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    disabled={items.length <= minItems}
                    onClick={() => onChange(items.filter((_, i) => i !== index))}
                    className={buttonClass.danger}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => {
          const id = uniqueId(idBase, items.map((i) => i.id));
          onChange([...items, { id, label: `Option ${items.length + 1}` } as T]);
        }}
        className={`${buttonClass.ghost} mt-1`}
      >
        <Plus aria-hidden="true" className="size-4" /> Add
      </button>
      {withValue && <p className="mt-1 text-xs text-gray-500">Leave the score value empty for options such as &ldquo;Not applicable&rdquo; that never count toward a score.</p>}
    </fieldset>
  );
}
