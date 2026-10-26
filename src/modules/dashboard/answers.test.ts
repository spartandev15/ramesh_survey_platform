import { describe, expect, it } from "vitest";
import { definitionSchema } from "@/modules/instruments/definition";
import type { Answers } from "@/modules/instruments/evaluate";
import { answerFilterOptions, answerFilterParam, describeAnswerFilter, matchesAnswer, parseAnswerFilter, questionResults } from "./answers";
import { parseFilters, filtersToQuery } from "./cohort";

const definition = definitionSchema.parse({
  schemaVersion: 1,
  pages: [
    {
      id: "p1",
      questions: [
        { id: "repair", type: "rating", title: "How was the repair?", min: 1, max: 5 },
        { id: "again", type: "single_choice", title: "Would you come back?", choices: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
        { id: "liked", type: "multi_choice", title: "What did you like?", choices: [{ id: "speed", label: "Speed" }, { id: "price", label: "Price" }, { id: "staff", label: "Staff" }] },
        { id: "grid", type: "matrix", title: "Rate each", rows: [{ id: "call", label: "Phone calls" }], columns: [{ id: "good", label: "Good", value: 2 }, { id: "poor", label: "Poor", value: 1 }] },
        { id: "days", type: "number", title: "Days without a car" },
        { id: "note", type: "text", title: "Anything else?" },
      ],
    },
  ],
});

const responses: { id: string; answers: Answers | null }[] = [
  { id: "r1", answers: { repair: 1, again: "no", liked: ["price"], grid: { call: "poor" }, days: 9, note: "Too slow" } },
  { id: "r2", answers: { repair: 2, again: "no", liked: ["price", "staff"], grid: { call: "poor" }, days: 3, note: "" } },
  { id: "r3", answers: { repair: 5, again: "yes", liked: ["speed", "staff"], grid: { call: "good" } } },
  { id: "r4", answers: null },
];

describe("answer filter", () => {
  it("reads only well-formed filters from the URL", () => {
    expect(parseAnswerFilter("repair:lte:2")).toEqual({ question: "repair", op: "lte", value: "2" });
    expect(parseAnswerFilter("grid.call:eq:poor")).toEqual({ question: "grid", row: "call", op: "eq", value: "poor" });
    for (const bad of ["", "repair", "repair:like:2", "repair:lte:two", "Repair:eq:1", "x:eq:1;drop", ["repair:eq:1"], undefined]) expect(parseAnswerFilter(bad)).toBeNull();
    expect(answerFilterParam(parseAnswerFilter("grid.call:eq:poor")!)).toBe("grid.call:eq:poor");
  });

  it("matches ratings, choices, picks and matrix rows; an unanswered question never matches", () => {
    const ids = (f: string) => responses.filter((r) => matchesAnswer(r.answers, parseAnswerFilter(f)!)).map((r) => r.id);
    expect(ids("repair:lte:2")).toEqual(["r1", "r2"]);
    expect(ids("repair:gte:5")).toEqual(["r3"]);
    expect(ids("repair:eq:2")).toEqual(["r2"]);
    expect(ids("again:eq:no")).toEqual(["r1", "r2"]);
    expect(ids("liked:has:staff")).toEqual(["r2", "r3"]);
    expect(ids("liked:eq:staff")).toEqual([]);
    expect(ids("grid.call:eq:poor")).toEqual(["r1", "r2"]);
    expect(ids("days:gte:3")).toEqual(["r1", "r2"]);
  });

  it("travels through the dashboard filters and back", () => {
    const f = parseFilters({ answer: "repair:lte:2" }, "2026-10-26");
    expect(f.answer).toEqual({ question: "repair", op: "lte", value: "2" });
    expect(new URLSearchParams(filtersToQuery(f)).get("answer")).toBe("repair:lte:2");
    expect(new URLSearchParams(filtersToQuery(parseFilters({}, "2026-10-26"))).has("answer")).toBe(false);
  });

  it("describes a filter in the survey's own words", () => {
    expect(describeAnswerFilter(parseAnswerFilter("repair:lte:2")!, [definition])).toBe("How was the repair?: 2 or lower");
    expect(describeAnswerFilter(parseAnswerFilter("liked:has:staff")!, [definition])).toBe("What did you like?: includes Staff");
    expect(describeAnswerFilter(parseAnswerFilter("grid.call:eq:poor")!, [definition])).toBe("Rate each (Phone calls): Poor");
    expect(describeAnswerFilter(parseAnswerFilter("gone:eq:x")!, [definition])).toBe("gone: x");
  });

  it("offers every answer of the filterable questions", () => {
    const groups = answerFilterOptions(definition);
    expect(groups.map((g) => g.label)).toEqual(["How was the repair?", "Would you come back?", "What did you like?", "Rate each: Phone calls"]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["1", "2", "3", "4", "5", "2 or lower", "3 or lower", "4 or lower", "2 or higher", "3 or higher", "4 or higher"]);
    expect(groups[3].options.map((o) => o.value)).toEqual(["grid.call:eq:good", "grid.call:eq:poor"]);
  });
});

describe("question results", () => {
  const results = questionResults(definition, responses);
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));

  it("counts each rating value and choice, leaving unanswered responses out", () => {
    const repair = byId.repair;
    expect(repair).toMatchObject({ kind: "bars", answered: 3, multi: false });
    if (repair.kind !== "bars") throw new Error("bars");
    expect(repair.bars.map((b) => b.count)).toEqual([1, 1, 0, 0, 1]);
    expect(repair.average).toBeCloseTo(8 / 3);
    expect(repair.bars[0].filter).toBe("repair:eq:1");
    const liked = byId.liked;
    if (liked.kind !== "bars") throw new Error("bars");
    expect(liked.multi).toBe(true);
    expect(liked.bars.map((b) => [b.label, b.count])).toEqual([["Speed", 1], ["Price", 2], ["Staff", 2]]);
  });

  it("counts matrix cells per row, and summarises numbers and text", () => {
    const grid = byId.grid;
    if (grid.kind !== "matrix") throw new Error("matrix");
    expect(grid.rows[0]).toMatchObject({ label: "Phone calls", answered: 3 });
    expect(grid.rows[0].cells.map((c) => c.count)).toEqual([1, 2]);
    expect(byId.days).toMatchObject({ kind: "number", answered: 2, average: 6, min: 3, max: 9 });
    // An empty comment is not an answer.
    expect(byId.note).toMatchObject({ kind: "text", answered: 1, latest: [{ responseId: "r1", text: "Too slow" }] });
  });

  it("treats empty picks and grids as unanswered", () => {
    const blank = questionResults(definition, [{ id: "b", answers: { liked: [], grid: {}, note: "  " } }]);
    expect(blank.find((r) => r.id === "liked")?.answered).toBe(0);
    expect(blank.find((r) => r.id === "grid")?.answered).toBe(0);
    expect(blank.find((r) => r.id === "note")?.answered).toBe(0);
    expect(matchesAnswer({ liked: [] }, parseAnswerFilter("liked:has:price")!)).toBe(false);
  });

  it("summarises a long rating scale like a number, with no filter per point", () => {
    const wide = definitionSchema.parse({ schemaVersion: 1, pages: [{ id: "p1", questions: [{ id: "pct", type: "rating", title: "Percent", min: 0, max: 100 }] }] });
    expect(questionResults(wide, [{ id: "a", answers: { pct: 40 } }, { id: "b", answers: { pct: 80 } }])[0]).toMatchObject({ kind: "number", average: 60, min: 40, max: 80 });
    expect(answerFilterOptions(wide)).toEqual([]);
  });
});
