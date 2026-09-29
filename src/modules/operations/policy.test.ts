import { describe, expect, it } from "vitest";
import { filterItems, historyLabel, isSubjectType, isSuppressionOverdue, sortItems, workerHealth } from "./policy";

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
