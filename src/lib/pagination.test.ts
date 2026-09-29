import { describe, expect, it } from "vitest";
import { pageNumber, pageOf, pageWindow } from "./pagination";

describe("pagination", () => {
  it("reads the page from the URL and falls back to page 1", () => {
    expect(pageNumber("3")).toBe(3);
    expect(pageNumber(["2", "5"])).toBe(2);
    for (const bad of [undefined, "", "0", "-1", "1.5", "abc"]) expect(pageNumber(bad)).toBe(1);
  });

  it("clamps to the pages that exist", () => {
    expect(pageWindow(1, 0)).toEqual({ page: 1, pageCount: 1, offset: 0, size: 20 });
    expect(pageWindow(3, 41)).toEqual({ page: 3, pageCount: 3, offset: 40, size: 20 });
    expect(pageWindow(9, 41)).toMatchObject({ page: 3, offset: 40 });
    expect(pageWindow(2, 40)).toMatchObject({ page: 2, pageCount: 2, offset: 20 });
  });

  it("slices an in-memory list without losing or repeating a row", () => {
    const all = Array.from({ length: 43 }, (_, i) => i);
    const pages = [1, 2, 3].map((p) => pageOf(all, p));
    expect(pages.map((p) => p.items.length)).toEqual([20, 20, 3]);
    expect(pages.flatMap((p) => p.items)).toEqual(all);
    expect(pages[2]).toMatchObject({ page: 3, pageCount: 3, total: 43 });
  });
});
