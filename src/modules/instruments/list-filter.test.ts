import { describe, expect, it } from "vitest";
import { filterSurveys, parseSurveyFilters, surveyStatus } from "./list-filter";

const at = (iso: string) => new Date(iso);
const survey = (id: string, versions: { status: "draft" | "published"; isTest?: boolean; version: number; publishedAt?: string }[], extra: Partial<{ name: string; shopId: string; description: string; createdAt: string }> = {}) => ({
  id,
  name: extra.name ?? `Survey ${id}`,
  key: `survey_${id}`,
  description: extra.description ?? null,
  shopId: extra.shopId ?? null,
  createdAt: at(extra.createdAt ?? "2026-09-01T00:00:00Z"),
  versions: versions.map((v) => ({ status: v.status, isTest: v.isTest ?? false, version: v.version, publishedAt: v.publishedAt ? at(v.publishedAt) : null })),
});

describe("survey list", () => {
  const items = [
    survey("a", [{ status: "published", isTest: true, version: 1, publishedAt: "2026-09-10T00:00:00Z" }], { name: "Demo survey", createdAt: "2026-08-01T00:00:00Z" }),
    survey("b", [
      { status: "published", version: 1, publishedAt: "2026-07-01T00:00:00Z" },
      { status: "published", version: 2, publishedAt: "2026-09-20T00:00:00Z" },
      { status: "draft", version: 3 },
    ], { name: "Vehicle survey", description: "After delivery" }),
    survey("c", [{ status: "draft", version: 1 }], { name: "Brand new", shopId: "shop-1", createdAt: "2026-09-25T00:00:00Z" }),
  ];
  const ids = (params: Record<string, string>) => filterSurveys(items, parseSurveyFilters(params)).map((s) => s.id);

  it("takes its status from the latest published version", () => {
    expect(items.map(surveyStatus)).toEqual(["test", "published", "draft"]);
  });

  it("filters by status, type and words in the name, key or description", () => {
    expect(ids({ status: "published" })).toEqual(["b"]);
    expect(ids({ status: "draft" })).toEqual(["c"]);
    expect(ids({ type: "addition" })).toEqual(["c"]);
    expect(ids({ type: "core" })).toEqual(["b", "a"]);
    expect(ids({ q: "DELIVERY" })).toEqual(["b"]);
    expect(ids({ q: "survey_a" })).toEqual(["a"]);
  });

  it("sorts by latest publish by default, then by name or newest", () => {
    expect(ids({})).toEqual(["b", "a", "c"]);
    expect(ids({ sort: "name" })).toEqual(["c", "a", "b"]);
    expect(ids({ sort: "newest" })).toEqual(["c", "b", "a"]);
    expect(parseSurveyFilters({ sort: "sideways", status: "gone" })).toMatchObject({ sort: "published", status: "all" });
  });
});
