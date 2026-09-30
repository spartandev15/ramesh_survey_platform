import { describe, expect, it } from "vitest";
import { parseResponseQuery, selectedIds } from "./list-query";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("response list address", () => {
  it("reads the queue tab, source, counted state, period and search", () => {
    expect(parseResponseQuery({ status: "visit_unmatched", source: "paper", state: "counted", since: "30", q: "  Quinn  " })).toEqual({
      matchStatus: "visit_unmatched",
      source: "paper",
      counted: true,
      sinceDays: 30,
      q: "Quinn",
    });
    expect(parseResponseQuery({ state: "not_counted" })).toEqual({ counted: false });
  });

  it("ignores anything unknown", () => {
    expect(parseResponseQuery({ status: "matched", source: "fax", state: "maybe", since: "45", q: "" })).toEqual({});
  });

  it("keeps only real ids for a selected export, once each", () => {
    expect(selectedIds({ id: [A, "nope", B, A] })).toEqual([A, B]);
    expect(selectedIds({ id: A })).toEqual([A]);
    expect(selectedIds({})).toEqual([]);
  });
});
