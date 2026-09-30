"use client";

import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Ticked rows for "Export selected". The row checkboxes belong to the
 * export form by its id, so the browser sends them as ?id=… itself; these
 * two controls only select every row on the page and count the ticks.
 */
// The page renders the form with this same id (a constant from a client file cannot be read on the server).
const EXPORT_FORM = "export-selected";
const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${EXPORT_FORM}"][name="id"]`));

function useTicked() {
  const [ticked, setTicked] = useState(0);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const update = () => {
      const all = boxes();
      setTotal(all.length);
      setTicked(all.filter((b) => b.checked).length);
    };
    update();
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, []);
  return { ticked, total };
}

export function SelectAll() {
  const ref = useRef<HTMLInputElement>(null);
  const { ticked, total } = useTicked();
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = ticked > 0 && ticked < total;
  }, [ticked, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select every response on this page"
      checked={total > 0 && ticked === total}
      onChange={(e) => {
        for (const b of boxes()) b.checked = e.target.checked;
        document.dispatchEvent(new Event("change"));
      }}
      className="size-4 rounded border-gray-300 accent-indigo-600"
    />
  );
}

export function ExportSelected() {
  const { ticked } = useTicked();
  return (
    <button
      type="submit"
      form={EXPORT_FORM}
      disabled={ticked === 0}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download aria-hidden="true" className="size-4" />
      Export selected{ticked > 0 ? ` (${ticked})` : ""}
    </button>
  );
}
