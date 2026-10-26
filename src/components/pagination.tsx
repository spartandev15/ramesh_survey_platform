import Link from "next/link";
import { LinkPending } from "./loading";

interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  size: number;
  /** Path of the list page, e.g. "/psg/alerts". */
  path: string;
  /** Current search params; every other filter or tab is kept when the page changes. */
  query?: Record<string, string | string[] | undefined>;
  /** Search param holding the page number; lists sharing a screen each use their own. */
  param?: string;
  /** Named for screen readers, e.g. "Responses pages". */
  label: string;
  /** Scroll target after a page change, e.g. "members". */
  anchor?: string;
}

/** Page numbers to show: first, last and the two around the current page, with gaps as null. */
function visiblePages(page: number, pageCount: number): (number | null)[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? [null, p] : [p]));
}

/**
 * "Showing 26–50 of 312" with Previous, page numbers and Next. Plain links, so
 * it needs no JavaScript and works with the keyboard and screen readers.
 * Hidden when everything fits on one page.
 */
export function Pagination({ page, pageCount, total, size, path, query = {}, param = "page", label, anchor }: PaginationProps) {
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === param || value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
    }
    if (p > 1) params.set(param, String(p));
    const search = params.toString();
    return `${path}${search ? `?${search}` : ""}${anchor ? `#${anchor}` : ""}`;
  };
  const first = (page - 1) * size + 1;
  const last = Math.min(page * size, total);
  const link = "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-brand-navy-900 hover:bg-gray-50";

  return (
    <nav aria-label={label} className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-gray-600">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {page > 1 && (
          <Link href={href(page - 1)} className={link} rel="prev">
            Previous
            <LinkPending className="size-3.5" />
          </Link>
        )}
        {visiblePages(page, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1 text-sm text-gray-500" aria-hidden="true">
              …
            </span>
          ) : p === page ? (
            <span key={p} aria-current="page" className="rounded-md bg-brand-navy-900 px-3 py-1.5 text-sm font-medium text-white">
              <span className="sr-only">Page </span>
              {p}
            </span>
          ) : (
            <Link key={p} href={href(p)} className={link}>
              <span className="sr-only">Page </span>
              {p}
              <LinkPending className="size-3.5" />
            </Link>
          ),
        )}
        {page < pageCount && (
          <Link href={href(page + 1)} className={link} rel="next">
            Next
            <LinkPending className="size-3.5" />
          </Link>
        )}
      </div>
    </nav>
  );
}
