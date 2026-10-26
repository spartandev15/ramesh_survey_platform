"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { InlineLoading } from "./loading";

/** The form's own visible fields; hidden ones only carry the other filters for a no-JavaScript submit. */
function fieldsOf(form: HTMLFormElement | null) {
  return Array.from(form?.elements ?? []).filter((el): el is HTMLInputElement | HTMLSelectElement => (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.name !== "" && el.type !== "hidden");
}

/**
 * A filter form that applies itself: selects at once, typing after a short
 * pause. It changes only its own fields in the address, keeps the rest (queue
 * tab, owner, test data) and goes back to page 1. Without JavaScript it is a
 * plain GET form, so Enter still works.
 */
export function LiveForm({ label, className, spinnerInside = false, children }: { label: string; className?: string; spinnerInside?: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pending, startTransition] = useTransition();

  // Keep the fields in step with the address (Back button, links) unless the user is typing in one.
  useEffect(() => {
    for (const el of fieldsOf(form.current)) {
      if (el === document.activeElement) continue;
      el.value = params.get(el.name) ?? "";
      // A select with no such option (no "any" choice, or an id the page replaced) keeps what the server chose instead of going blank.
      if (el instanceof HTMLSelectElement && el.selectedIndex === -1) for (const option of el.options) option.selected = option.defaultSelected;
    }
  }, [params]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function apply() {
    clearTimeout(timer.current);
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    for (const el of fieldsOf(form.current)) {
      const value = el.value.trim();
      if (value) next.set(el.name, value);
      else next.delete(el.name);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <form
      ref={form}
      action={pathname}
      aria-label={label}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      onChange={(e) => {
        if (e.target instanceof HTMLSelectElement) apply();
      }}
      onInput={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === "search") {
          clearTimeout(timer.current);
          timer.current = setTimeout(apply, 300);
        }
      }}
    >
      {children}
      <InlineLoading pending={pending} inside={spinnerInside} />
    </form>
  );
}
