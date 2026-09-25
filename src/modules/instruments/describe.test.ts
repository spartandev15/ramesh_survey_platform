import { describe, expect, it } from "vitest";
import { demoDefinition } from "./demo-definition";
import { allQuestions, type Question } from "./definition";
import { describeCondition, formatAnswer } from "./describe";

const q = (id: string) => allQuestions(demoDefinition).find((x) => x.id === id) as Question;

describe("readable answers", () => {
  it("shows option labels with their stable IDs", () => {
    expect(formatAnswer(q("ready_on_time"), "no")).toBe("No (no)");
    expect(formatAnswer(q("improve_areas"), ["updates", "billing"])).toBe("Repair status updates (updates), Explaining the bill (billing)");
  });

  it("keeps skipped matrix rows visible instead of treating them as zero", () => {
    expect(formatAnswer(q("service_aspects"), { communication: "good" })).toBe(
      "Communication during the repair: Good (good); Quality of the repair: skipped; Cleanliness of the vehicle at pickup: skipped",
    );
  });

  it("returns null for a skipped question", () => {
    expect(formatAnswer(q("overall_rating"), undefined)).toBeNull();
    expect(formatAnswer(q("overall_rating"), 0)).toBe("0");
  });

  it("describes nested conditions", () => {
    expect(describeCondition({ any: [{ question: "a", op: "lte", value: 2 }, { all: [{ metric: "m", op: "is_null" }, { question: "b", op: "answered" }] }] })).toBe(
      "a ≤ 2 OR (metric m has no value AND b is answered)",
    );
  });
});
