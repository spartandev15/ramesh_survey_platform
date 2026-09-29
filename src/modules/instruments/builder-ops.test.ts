import { describe, expect, it } from "vitest";
import {
  changeOp,
  insertQuestion,
  moveQuestion,
  convertQuestion,
  defaultClauseForQuestion,
  fromEditable,
  moveItem,
  newQuestion,
  opsForQuestion,
  questionReferences,
  toEditable,
  uniqueId,
} from "./builder-ops";
import { demoDefinition } from "./demo-definition";
import { parseDefinition, type Question } from "./definition";
import { allQuestions } from "./questions";

const q = (id: string) => allQuestions(demoDefinition).find((x) => x.id === id) as Question;

describe("builder ids", () => {
  it("never reuses an existing id", () => {
    expect(uniqueId("question", ["question_1", "question_2"])).toBe("question_3");
    expect(uniqueId("question", [])).toBe("question_1");
  });

  it("creates new questions of every type that pass the definition schema", () => {
    for (const type of ["single_choice", "multi_choice", "rating", "number", "text", "matrix"] as const) {
      const question = newQuestion(type, []);
      const parsed = parseDefinition({ schemaVersion: 1, pages: [{ id: "p", questions: [question] }] });
      expect(parsed.ok, type).toBe(true);
    }
  });
});

describe("changing a question's type", () => {
  it("keeps id, title and display rule", () => {
    const converted = convertQuestion(q("delay_detail"), "rating");
    expect(converted).toMatchObject({ id: "delay_detail", type: "rating", title: q("delay_detail").title, visibleWhen: q("delay_detail").visibleWhen });
  });

  it("keeps options between choice types", () => {
    const converted = convertQuestion(q("ready_on_time"), "multi_choice");
    expect(converted.type === "multi_choice" && converted.choices.map((c) => c.id)).toEqual(["yes", "no"]);
  });
});

describe("condition editing", () => {
  it("round-trips simple conditions and rejects nested ones", () => {
    const leaf = { question: "overall_rating", op: "lte" as const, value: 2 };
    expect(fromEditable(toEditable(leaf)!)).toEqual(leaf);
    expect(fromEditable(toEditable({ any: [leaf, leaf] })!)).toEqual({ any: [leaf, leaf] });
    expect(toEditable(undefined)).toEqual({ join: "all", clauses: [] });
    expect(fromEditable({ join: "all", clauses: [] })).toBeUndefined();
    expect(toEditable({ all: [leaf, { any: [leaf] }] })).toBeNull();
  });

  it("offers only operators that fit the question type", () => {
    expect(opsForQuestion(q("comments"))).toEqual(["answered", "not_answered"]);
    expect(opsForQuestion(q("improve_areas"))).toContain("includes");
    expect(opsForQuestion(q("improve_areas"))).not.toContain("equals");
    expect(opsForQuestion(q("ready_on_time"))).toContain("lte");
  });

  it("builds default clauses that validate", () => {
    const clause = defaultClauseForQuestion(q("service_aspects"));
    expect(clause).toEqual({ question: "service_aspects", row: "communication", op: "equals", value: "poor" });
  });

  it("changes operator while keeping a compatible value", () => {
    const clause = { question: "ready_on_time", op: "equals" as const, value: "no" };
    expect(changeOp(clause, "in", q("ready_on_time"))).toEqual({ question: "ready_on_time", op: "in", values: ["no"] });
    expect(changeOp(clause, "answered", q("ready_on_time"))).toEqual({ question: "ready_on_time", op: "answered" });
    expect(changeOp({ metric: "m", op: "lt", value: 3 }, "is_null", undefined)).toEqual({ metric: "m", op: "is_null" });
  });
});

describe("drag and drop", () => {
  const ids = (d: typeof demoDefinition) => d.pages.map((p) => p.questions.map((x) => x.id));

  it("reorders within a page", () => {
    const d = structuredClone(demoDefinition);
    expect(moveQuestion(d, { page: 0, index: 0 }, { page: 0, index: 2 })).toEqual({ page: 0, index: 2 });
    expect(ids(d)[0]).toEqual(["ready_on_time", "delay_detail", "overall_rating", "service_aspects"]);
  });

  it("moves across pages and clamps to the end", () => {
    const d = structuredClone(demoDefinition);
    expect(moveQuestion(d, { page: 1, index: 2 }, { page: 0, index: 99 })).toEqual({ page: 0, index: 4 });
    expect(ids(d)[0].at(-1)).toBe("comments");
    expect(ids(d)[1]).toEqual(["recommend_score", "improve_areas"]);
  });

  it("flags a question dragged above the question its display rule depends on", async () => {
    const { validateDefinition } = await import("./definition");
    const d = structuredClone(demoDefinition);
    moveQuestion(d, { page: 0, index: 2 }, { page: 0, index: 0 }); // delay_detail above ready_on_time
    expect(validateDefinition(d).some((i) => i.message.includes("must come earlier"))).toBe(true);
  });

  it("inserts a new question at the drop position", () => {
    const d = structuredClone(demoDefinition);
    const q = newQuestion("text", ids(d).flat());
    expect(insertQuestion(d, q, { page: 1, index: 1 })).toEqual({ page: 1, index: 1 });
    expect(ids(d)[1][1]).toBe(q.id);
  });
});

describe("builder safety", () => {
  it("lists everything that refers to a question before it is deleted", () => {
    expect(questionReferences(demoDefinition, "overall_rating")).toEqual(["alert low_overall", "suppression hold_routine_mail"]);
    expect(questionReferences(demoDefinition, "ready_on_time")).toEqual(["question delay_detail", "metric on_time", "alert not_on_time"]);
  });

  it("moves items within bounds only", () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
