"use client";

import { Loader2 } from "lucide-react";
import { useLinkStatus } from "next/link";

/** Shown in place of a workspace page while it loads, so a click visibly did something. */
export function PageLoading() {
  return (
    <div role="status" className="flex min-h-[40vh] items-center justify-center gap-3 text-sm text-gray-600">
      <Loader2 aria-hidden="true" className="size-6 animate-spin text-indigo-600" />
      Loading…
    </div>
  );
}

/** A spinner inside a <Link> while the page it opens is loading. */
export function LinkPending({ className = "size-4" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-hidden="true" className={`${className} shrink-0 animate-spin`} /> : null;
}

/**
 * A small "Loading…" note next to filters while the list they change is loading. `inside` puts only the
 * spinner at the right end of a single search box (the form is positioned), so nothing moves.
 */
export function InlineLoading({ pending, inside = false }: { pending: boolean; inside?: boolean }) {
  return (
    <span
      role="status"
      className={inside ? "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" : "inline-flex items-center gap-1.5 text-sm text-gray-600"}
    >
      {pending && (
        <>
          <Loader2 aria-hidden="true" className="size-4 animate-spin text-indigo-600" />
          <span className={inside ? "sr-only" : undefined}>Loading…</span>
        </>
      )}
    </span>
  );
}
