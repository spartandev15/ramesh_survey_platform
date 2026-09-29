import { describe, expect, it } from "vitest";
import { filterShops, parseShopFilters, shopFilterQuery } from "./list-filter";

const shops = [
  { id: "1", name: "Beta Body", publicSlug: "beta", isTestShop: false, createdAt: new Date("2026-01-02") },
  { id: "2", name: "alpha Auto", publicSlug: "alpha-auto", isTestShop: true, createdAt: new Date("2026-03-01") },
  { id: "3", name: "Gamma Collision", publicSlug: "gamma", isTestShop: false, createdAt: new Date("2026-02-01") },
];
const modes = new Map([
  ["1", "live" as const],
  ["2", "test" as const],
  ["3", "paused" as const],
]);
const names = (f: Record<string, string>) => filterShops([...shops], modes, parseShopFilters(f)).map((s) => s.name);

describe("shop list filters", () => {
  it("falls back to the defaults for missing or unknown values", () => {
    expect(parseShopFilters({ mode: "bogus", type: "x", sort: "?" })).toEqual({ q: "", mode: "all", type: "all", sort: "name" });
    expect(shopFilterQuery(parseShopFilters({}))).toEqual({});
  });

  it("searches name and public link, ignoring case", () => {
    expect(names({ q: "ALPHA" })).toEqual(["alpha Auto"]);
    expect(names({ q: "gamma" })).toEqual(["Gamma Collision"]);
  });

  it("filters by mode and type", () => {
    expect(names({ mode: "live" })).toEqual(["Beta Body"]);
    expect(names({ type: "test" })).toEqual(["alpha Auto"]);
    expect(names({ type: "production" })).toEqual(["Beta Body", "Gamma Collision"]);
  });

  it("sorts by name or by date", () => {
    expect(names({})).toEqual(["alpha Auto", "Beta Body", "Gamma Collision"]);
    expect(names({ sort: "name_desc" })).toEqual(["Gamma Collision", "Beta Body", "alpha Auto"]);
    expect(names({ sort: "newest" })).toEqual(["alpha Auto", "Gamma Collision", "Beta Body"]);
    expect(names({ sort: "oldest" })).toEqual(["Beta Body", "Gamma Collision", "alpha Auto"]);
  });

  it("keeps only non-default filters in the query", () => {
    expect(shopFilterQuery(parseShopFilters({ q: " body ", mode: "live", sort: "newest" }))).toEqual({ q: "body", mode: "live", sort: "newest" });
  });
});
