import { describe, expect, it } from "vitest";
import { bucketOf, bucketsBetween, categorize, granularityFor, inCohort, localDate, parseFilters, summarize, type CohortRow } from "./cohort";

const base: CohortRow = {
  id: "r1",
  submittedAt: new Date("2026-09-10T15:00:00Z"),
  deliveredOn: "2026-09-05",
  source: "online",
  isTest: false,
  matchStatus: "matched",
  canonical: true,
  duplicateDisposition: null,
  versionId: "v1",
  metrics: { index: 0.5 },
  alerts: [],
};

describe("categorize (SR-28, SR-31)", () => {
  it("scores only the canonical matched response", () => {
    expect(categorize(base, false)).toBe("counted");
    expect(categorize({ ...base, canonical: false, matchStatus: "visit_unmatched" }, false)).toBe("pending_match");
    expect(categorize({ ...base, canonical: false, matchStatus: "duplicate_review" }, false)).toBe("duplicate");
    expect(categorize({ ...base, canonical: false, duplicateDisposition: "kept_original" }, false)).toBe("duplicate");
    expect(categorize({ ...base, canonical: false, duplicateDisposition: "legacy_reference" }, false)).toBe("legacy_reference");
  });

  it("keeps test data out of a production shop but shows it in an internal test shop", () => {
    expect(categorize({ ...base, isTest: true }, false)).toBe("excluded_test");
    expect(categorize({ ...base, isTest: true }, true)).toBe("counted");
  });
});

describe("filters", () => {
  it("defaults to the last 90 days by submission and ignores junk", () => {
    expect(parseFilters({}, "2026-09-27")).toEqual({ from: "2026-06-30", to: "2026-09-27", basis: "submitted", source: "all", version: "all" });
    expect(parseFilters({ from: "nope", source: "fax", version: "1; drop", basis: "x" }, "2026-09-27").source).toBe("all");
    expect(parseFilters({ from: "2026-09-20", to: "2026-09-01" }, "2026-09-27")).toMatchObject({ from: "2026-09-01", to: "2026-09-20" });
  });

  it("uses the shop's local date, inclusive at both ends", () => {
    const f = { from: "2026-09-10", to: "2026-09-10", basis: "submitted" as const, source: "all" as const, version: "all" };
    // 02:00 UTC on Sep 11 is still Sep 10 in Chicago.
    expect(inCohort({ ...base, submittedAt: new Date("2026-09-11T02:00:00Z") }, f, "America/Chicago")).toBe(true);
    expect(inCohort({ ...base, submittedAt: new Date("2026-09-11T02:00:00Z") }, f, "UTC")).toBe(false);
    expect(localDate(new Date("2026-09-11T02:00:00Z"), "America/Chicago")).toBe("2026-09-10");
  });

  it("filters by delivery date, source and version; unmatched rows have no delivery date", () => {
    const f = { from: "2026-09-01", to: "2026-09-30", basis: "delivered" as const, source: "all" as const, version: "all" };
    expect(inCohort(base, f, "UTC")).toBe(true);
    expect(inCohort({ ...base, deliveredOn: null }, f, "UTC")).toBe(false);
    expect(inCohort(base, { ...f, source: "paper" }, "UTC")).toBe(false);
    expect(inCohort(base, { ...f, version: "v2" }, "UTC")).toBe(false);
  });
});

describe("time buckets for the charts", () => {
  it("uses days for short ranges, weeks for medium and months for long", () => {
    expect(granularityFor("2026-09-01", "2026-09-30")).toBe("day");
    expect(granularityFor("2026-07-01", "2026-09-30")).toBe("week");
    expect(granularityFor("2026-01-01", "2026-12-31")).toBe("month");
  });

  it("puts a date in its day, its week starting Monday, or its month", () => {
    // 2026-09-10 is a Thursday; that week starts Monday 2026-09-07.
    expect(bucketOf("2026-09-10", "week")).toBe("2026-09-07");
    expect(bucketOf("2026-09-07", "week")).toBe("2026-09-07");
    expect(bucketOf("2026-09-13", "week")).toBe("2026-09-07");
    expect(bucketOf("2026-09-10", "month")).toBe("2026-09");
  });

  it("lists every bucket in the range, so quiet periods show as zero", () => {
    expect(bucketsBetween("2026-09-01", "2026-09-03", "day")).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(bucketsBetween("2026-08-30", "2026-09-10", "week")).toEqual(["2026-08-24", "2026-08-31", "2026-09-07"]);
    expect(bucketsBetween("2026-08-15", "2026-10-01", "month")).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

describe("summarize (AT-28, AT-31)", () => {
  const year = { from: "2026-01-01", to: "2026-12-31", basis: "submitted" as const };
  const versions = new Map([
    ["v1", { label: "Survey v1", metrics: [{ id: "index", label: "Index" }] }],
    ["v2", { label: "Survey v2", metrics: [{ id: "index", label: "Index" }] }],
  ]);

  it("does not let unmatched, duplicate or test rows change the score", () => {
    const rows = [
      base,
      { ...base, id: "r2", metrics: { index: 1 } },
      { ...base, id: "r3", canonical: false, matchStatus: "visit_unmatched" as const, metrics: { index: 0 } },
      { ...base, id: "r4", canonical: false, matchStatus: "duplicate_review" as const, metrics: { index: 0 } },
      { ...base, id: "r5", isTest: true, metrics: { index: 0 } },
    ];
    const s = summarize(rows, false, versions, "UTC", year);
    expect(s.total).toBe(5);
    expect(s.counts).toEqual({ counted: 2, pending_match: 1, duplicate: 1, legacy_reference: 0, excluded_test: 1 });
    expect(s.groups[0].metrics[0]).toMatchObject({ average: 0.75, n: 2 });
  });

  it("treats a missing score as missing, not zero", () => {
    const s = summarize([base, { ...base, id: "r2", metrics: { index: null } }], false, versions, "UTC", year);
    expect(s.groups[0]).toMatchObject({ counted: 2 });
    expect(s.groups[0].metrics[0]).toMatchObject({ average: 0.5, n: 1 });
  });

  it("never averages different survey versions together", () => {
    const s = summarize([base, { ...base, id: "r2", versionId: "v2", metrics: { index: 1 } }], false, versions, "UTC", year);
    expect(s.groups.map((g) => [g.label, g.metrics[0].average])).toEqual(
      expect.arrayContaining([
        ["Survey v1", 0.5],
        ["Survey v2", 1],
      ]),
    );
  });

  it("builds a monthly trend in shop time and counts responses with alerts", () => {
    const rows = [base, { ...base, id: "r2", submittedAt: new Date("2026-08-31T23:30:00Z"), alerts: [{ id: "low", label: "Low" }] }];
    const s = summarize(rows, false, versions, "UTC", year);
    expect(s.groups[0].trend.map((t) => t.bucket)).toEqual(["2026-08", "2026-09"]);
    expect(s.groups[0].withAlerts).toBe(1);
  });
});

describe("chart data (SR-31)", () => {
  const versions = new Map([["v1", { label: "Survey v1", metrics: [{ id: "index", label: "Index" }] }]]);
  const september = { from: "2026-09-01", to: "2026-09-30", basis: "submitted" as const };

  it("splits each day's responses into counted and not counted, with zeros for quiet days", () => {
    const rows = [base, { ...base, id: "r2", matchStatus: "visit_unmatched" as const, canonical: false }, { ...base, id: "r3", submittedAt: new Date("2026-09-12T15:00:00Z") }];
    const s = summarize(rows, false, versions, "UTC", september);
    expect(s.granularity).toBe("day");
    expect(s.volume).toHaveLength(30);
    expect(s.volume.find((v) => v.bucket === "2026-09-10")).toEqual({ bucket: "2026-09-10", counted: 1, other: 1 });
    expect(s.volume.find((v) => v.bucket === "2026-09-11")).toEqual({ bucket: "2026-09-11", counted: 0, other: 0 });
    expect(s.volume.reduce((n, v) => n + v.counted + v.other, 0)).toBe(rows.length);
  });

  it("counts sources and negative feedback across every submitted response in view", () => {
    const rows = [base, { ...base, id: "r2", source: "paper" as const, alerts: [{ id: "low", label: "Low" }] }, { ...base, id: "r3", source: "public" as const, isTest: true }];
    const s = summarize(rows, false, versions, "UTC", september);
    expect(s.sources).toEqual({ online: 1, paper: 1, public: 1 });
    expect(s.withAlerts).toBe(1);
  });
});
