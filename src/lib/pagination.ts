/**
 * Page-by-page lists, so no screen grows into a long scroll and no list
 * silently stops at a fixed cap. Page numbers come from the URL (?page=2),
 * so a page can be bookmarked and survives a refresh or a saved action.
 */

const PAGE_SIZE = 20;

export interface Paged<T> {
  items: T[];
  /** 1-based and always within 1..pageCount. */
  page: number;
  pageCount: number;
  total: number;
  size: number;
}

/** The requested page from a search param; anything invalid means page 1. */
export function pageNumber(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Clamp a requested page to the pages that exist and return its row offset. */
export function pageWindow(requested: number, total: number, size = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, offset: (page - 1) * size, size };
}

/** One page of a list that is already in memory. */
export function pageOf<T>(all: T[], requested: number, size = PAGE_SIZE): Paged<T> {
  const { page, pageCount, offset } = pageWindow(requested, all.length, size);
  return { items: all.slice(offset, offset + size), page, pageCount, total: all.length, size };
}

/** Count, clamp the page, then fetch only that page's rows (one transaction's connection, so in order). */
export async function loadPage<T>(
  requested: number,
  count: () => Promise<number>,
  list: (offset: number, size: number) => Promise<T[]>,
  size = PAGE_SIZE,
): Promise<Paged<T>> {
  const total = await count();
  const { page, pageCount, offset } = pageWindow(requested, total, size);
  const items = total === 0 ? [] : await list(offset, size);
  return { items, page, pageCount, total, size };
}
