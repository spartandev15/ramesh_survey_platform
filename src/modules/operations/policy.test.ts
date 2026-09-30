import { describe, expect, it } from "vitest";
import { filterItems, historyLabel, isSubjectType, ageBuckets, isSuppressionOverdue, parseQueueSearch, searchItems, sortItems, sortItemsBy, workerHealth } from "./policy";

const at = (iso: string) => new Date(iso);
const item = (overrides: Partial<{ overdue: boolean; since: Date; isTest: boolean; owner: { userId: string } | null; id: string }>) => ({
  id: "x",
  overdue: false,
  since: at("2026-09-20T10:00:00Z"),
  isTest: false,
  owner: null,
  ...overrides,
});

describe("suppression overdue (SR-38)", () => {
  it("is overdue from 24 hours after it was raised", () => {
    const raised = at("2026-09-27T10:00:00Z");
    expect(isSuppressionOverdue(raised, at("2026-09-28T09:59:59Z"))).toBe(false);
    expect(isSuppressionOverdue(raised, at("2026-09-28T10:00:00Z"))).toBe(true);
  });
});

describe("worker health (SR-38)", () => {
  const now = at("2026-09-28T12:00:00Z");
  it("reports a worker that never ran", () => {
    expect(workerHealth(null, now)).toMatchObject({ ok: false, since: null });
  });
  it("is healthy within five minutes of the last heartbeat", () => {
    expect(workerHealth(at("2026-09-28T11:55:01Z"), now)).toEqual({ ok: true });
  });
  it("reports a stopped worker with the last heartbeat time", () => {
    const last = at("2026-09-28T11:55:00Z");
    expect(workerHealth(last, now)).toMatchObject({ ok: false, since: last });
  });
});

describe("queue order and filters", () => {
  it("puts overdue items first, then the oldest", () => {
    const sorted = sortItems([
      item({ id: "new", since: at("2026-09-27T00:00:00Z") }),
      item({ id: "overdue", overdue: true, since: at("2026-09-26T00:00:00Z") }),
      item({ id: "old", since: at("2026-09-01T00:00:00Z") }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["overdue", "old", "new"]);
  });

  it("filters by owner and hides test data unless asked", () => {
    const items = [item({ id: "mine", owner: { userId: "u1" } }), item({ id: "theirs", owner: { userId: "u2" } }), item({ id: "free" }), item({ id: "test", isTest: true })];
    const ids = (owner: "all" | "mine" | "unassigned", includeTest = false) => filterItems(items, { owner, userId: "u1", includeTest }).map((i) => i.id);
    expect(ids("all")).toEqual(["mine", "theirs", "free"]);
    expect(ids("all", true)).toEqual(["mine", "theirs", "free", "test"]);
    expect(ids("mine")).toEqual(["mine"]);
    expect(ids("unassigned")).toEqual(["free"]);
  });

  it("searches title, shop, reason and origin, and narrows to overdue or one shop", () => {
    const row = (id: string, extra: Partial<{ overdue: boolean; shopId: string | null; shopName: string | null; reason: string; provenance: string | null }> = {}) => ({
      ...item({ id, overdue: extra.overdue ?? false }),
      title: `Visit ${id}`,
      reason: extra.reason ?? "Email needed",
      shopId: extra.shopId ?? "s1",
      shopName: extra.shopName ?? "North Collision",
      provenance: extra.provenance ?? null,
    });
    const items = [row("a"), row("b", { overdue: true, shopId: "s2", shopName: "South Body" }), row("c", { provenance: "Imported from visits.csv, row 4" })];
    const ids = (params: Record<string, string>) => searchItems(items, parseQueueSearch(params)).map((i) => i.id);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ q: "south" })).toEqual(["b"]);
    expect(ids({ q: "VISITS.CSV row" })).toEqual(["c"]);
    expect(ids({ q: "email north" })).toEqual(["a", "c"]);
    expect(ids({ overdue: "1" })).toEqual(["b"]);
    expect(ids({ status: "overdue" })).toEqual(["b"]);
    expect(ids({ status: "on_time" })).toEqual(["a", "c"]);
    expect(ids({ shop: "s1" })).toEqual(["a", "c"]);
  });

  it("narrows to one owner and to items raised in a recent period", () => {
    const now = at("2026-09-30T12:00:00Z");
    const row = (id: string, since: string, owner: string | null) => ({ ...item({ id, since: at(since), owner: owner ? { userId: owner } : null }), title: id, reason: "", shopId: null, shopName: null, provenance: null });
    const items = [row("old", "2026-06-01T00:00:00Z", "u1"), row("month", "2026-09-10T00:00:00Z", "u2"), row("week", "2026-09-28T00:00:00Z", null)];
    const ids = (params: Record<string, string>) => searchItems(items, parseQueueSearch(params), now).map((i) => i.id);
    expect(ids({ who: "u2" })).toEqual(["month"]);
    expect(ids({ since: "7" })).toEqual(["week"]);
    expect(ids({ since: "30" })).toEqual(["month", "week"]);
    expect(ids({ since: "45" })).toEqual(["old", "month", "week"]);
    expect(parseQueueSearch({ sort: "sideways", status: "maybe" })).toMatchObject({ sort: "overdue", status: "all" });
  });

  it("sorts by waiting time and counts items by age", () => {
    const now = at("2026-09-30T00:00:00Z");
    const items = [item({ id: "b", since: at("2026-09-25T00:00:00Z") }), item({ id: "a", since: at("2026-01-01T00:00:00Z"), overdue: true }), item({ id: "c", since: at("2026-08-01T00:00:00Z") })];
    expect(sortItemsBy(items, "oldest").map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(sortItemsBy(items, "newest").map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(sortItemsBy(items, "overdue").map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(ageBuckets(items, now)).toEqual([1, 0, 1, 0, 1]);
  });
});

describe("subjects and labels", () => {
  it("accepts only known subject types", () => {
    expect(isSubjectType("email_intent")).toBe(true);
    expect(isSubjectType("alert_case")).toBe(false);
    expect(isSubjectType("")).toBe(false);
  });
  it("labels known history actions and keeps unknown codes visible", () => {
    expect(historyLabel("email.retry")).toBe("Retry requested");
    expect(historyLabel("something.new")).toBe("something.new");
  });
});
