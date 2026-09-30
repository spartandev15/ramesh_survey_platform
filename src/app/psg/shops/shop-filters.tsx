"use client";

import { Loader2, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

type Options = Record<string, string>;
const DEFAULTS: Record<string, string> = { q: "", mode: "all", type: "all", sort: "name" };

/**
 * Live search and filters: the list updates as you type (after a short
 * pause) and as soon as a filter changes. It is still a plain form, so
 * Enter works without JavaScript too.
 */
export function ShopFilters({ values, modes, types, sorts, per }: { values: Record<string, string>; modes: Options; types: Options; sorts: Options; per?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const form = useRef<HTMLFormElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pending, startTransition] = useTransition();

  // Keep the fields in step with the address (back button) unless the user is typing in one.
  useEffect(() => {
    for (const el of Array.from(form.current?.elements ?? []) as (HTMLInputElement | HTMLSelectElement)[]) {
      if (el.name in DEFAULTS && el !== document.activeElement) el.value = params.get(el.name) ?? DEFAULTS[el.name];
    }
  }, [params]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function apply() {
    clearTimeout(timer.current);
    if (!form.current) return;
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(form.current)) {
      const text = String(value).trim();
      // Only non-default values, and back to page 1 on every change.
      if (text && text !== DEFAULTS[key]) next.set(key, text);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function reset() {
    if (!form.current) return;
    for (const el of Array.from(form.current.elements) as (HTMLInputElement | HTMLSelectElement)[]) if (el.name in DEFAULTS) el.value = DEFAULTS[el.name];
    apply();
  }

  const active = Object.entries(DEFAULTS).some(([k, v]) => (values[k] ?? v) !== v);

  return (
    <form
      ref={form}
      role="search"
      aria-label="Find shops"
      action={pathname}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="flex flex-wrap items-end gap-2"
    >
      {/* Rows per page is chosen under the table; keep it when the filters change. */}
      {per && <input type="hidden" name="per" value={per} />}
      <label className="relative min-w-48 flex-1">
        <span className="sr-only">Search shops</span>
        {pending ? (
          <Loader2 aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-gray-500" />
        ) : (
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
        )}
        <input
          ref={search}
          type="search"
          name="q"
          defaultValue={values.q}
          maxLength={100}
          autoComplete="off"
          placeholder="Search by shop name or public link..."
          onChange={() => {
            clearTimeout(timer.current);
            timer.current = setTimeout(apply, 300);
          }}
          className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-brand-navy-700 focus:bg-white"
        />
      </label>
      <Select name="mode" label="Mode" value={values.mode} options={modes} onChange={apply} />
      <Select name="type" label="Type" value={values.type} options={types} onChange={apply} />
      <Select name="sort" label="Sort" value={values.sort} options={sorts} onChange={apply} />
      {active && (
        <button type="button" onClick={reset} className="h-10 px-2 text-sm text-gray-600 underline-offset-2 hover:underline">
          Reset
        </button>
      )}
    </form>
  );
}

function Select({ name, label, value, options, onChange }: { name: string; label: string; value: string; options: Options; onChange: () => void }) {
  // Tied by id, so the name read out is just the label, not the chosen option too.
  const id = `shop-filter-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-gray-500">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value} onChange={onChange} className="h-10 min-w-36 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-brand-navy-700">
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}
