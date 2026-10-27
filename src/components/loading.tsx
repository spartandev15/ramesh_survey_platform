"use client";

import { Loader2 } from "lucide-react";
import { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

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

/** A link's own content (an icon) swapped for a spinner while the page it opens is loading. */
export function PendingSwap({ children, className = "size-4" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-hidden="true" className={`${className} shrink-0 animate-spin`} /> : children;
}

/**
 * A thin bar across the top from a click on any in-app link until the address changes, so every
 * button, tab and filter shows that it is working, even when the page stays the same and only
 * its list reloads. A link to where you already are, a new tab or a download never starts it.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;
  // The address the click left from: the bar shows while the address is still that one.
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname + url.search === location.pathname + location.search) return;
      setFrom(location.pathname + location.search);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  // A navigation that never changes the address (an error, a redirect back here) stops the bar after a while.
  useEffect(() => {
    if (from === null) return;
    const stop = setTimeout(() => setFrom(null), 15_000);
    return () => clearTimeout(stop);
  }, [from]);

  if (from !== null && from !== here) setFrom(null);
  if (from !== here) return null;
  return (
    <div role="status" className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden">
      <span className="sr-only">Loading…</span>
    </div>
  );
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
