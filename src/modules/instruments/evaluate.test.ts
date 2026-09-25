import { describe, expect, it } from "vitest";
import { demoDefinition } from "./demo-definition";
import { computeOutcomes, EVALUATOR_VERSION, evaluateAnswers, evaluateSubmission, type Answers } from "./evaluate";

/** A complete, positive demo submission. */
const positive: Answers = {
  overall_rating: 5,
  ready_on_time: "yes",
  service_aspects: { communication: "excellent", quality: "excellent", cleanliness: "good" },
  recommend_score: 10,
};

function submit(answers: unknown) {
  const result = evaluateSubmission(demoDefinition, answers);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
}

describe("answer contract (PDF 05)", () => {
  it("accepts a valid submission", () => {
    expect(evaluateSubmission(demoDefinition, positive).ok).toBe(true);
  });

  it("rejects answers for questions outside the version", () => {
    const result = evaluateSubmission(demoDefinition, { ...positive, injected_score: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ questionId: "injected_score", code: "unknown_question" }));
  });

  it.each([
    ["rating out of range", { overall_rating: 6 }],
    ["rating not an integer", { overall_rating: 4.5 }],
    ["rating sent as text", { overall_rating: "5" }],
    ["unknown choice", { ready_on_time: "maybe" }],
    ["unknown matrix row", { service_aspects: { communication: "good", speed: "good", quality: "good", cleanliness: "good" } }],
    ["unknown matrix column", { service_aspects: { communication: "amazing", quality: "good", cleanliness: "good" } }],
  ])("rejects %s", (_label, override) => {
    const result = evaluateSubmission(demoDefinition, { ...positive, ...override });
    expect(result.ok).toBe(false);
  });

  it("rejects text longer than the allowed length", () => {
    const result = evaluateSubmission(demoDefinition, { ...positive, comments: "x".repeat(2001) });
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate or unknown multi-choice selections", () => {
    const low = { ...positive, recommend_score: 5 };
    expect(evaluateSubmission(demoDefinition, { ...low, improve_areas: ["timing", "timing"] }).ok).toBe(false);
    expect(evaluateSubmission(demoDefinition, { ...low, improve_areas: ["free_car"] }).ok).toBe(false);
  });

  it("stores multi-choice selections in definition order, so equal answers are stored identically", () => {
    const result = submit({ ...positive, recommend_score: 5, improve_areas: ["billing", "updates"] });
    expect(result.answers.improve_areas).toEqual(["updates", "billing"]);
  });

  it("trims text and treats blank text as a skip", () => {
    const result = submit({ ...positive, comments: "   " });
    expect(result.answers).not.toHaveProperty("comments");
    expect(submit({ ...positive, comments: "  Great work  " }).answers.comments).toBe("Great work");
  });
});

describe("requiredness and conditional display", () => {
  it("reports every missing required question at submission", () => {
    const result = evaluateSubmission(demoDefinition, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const required = result.errors.filter((e) => e.code === "required").map((e) => e.questionId);
      expect(required).toEqual(["overall_rating", "ready_on_time", "service_aspects", "recommend_score"]);
    }
  });

  it("requires every row of a required matrix", () => {
    const result = evaluateSubmission(demoDefinition, { ...positive, service_aspects: { communication: "good" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ questionId: "service_aspects", code: "required" }));
  });

  it("does not enforce requiredness on drafts (SR-16)", () => {
    const draft = evaluateAnswers(demoDefinition, { overall_rating: 4 }, "draft");
    expect(draft.errors).toEqual([]);
    expect(draft.answers).toEqual({ overall_rating: 4 });
  });

  it("still rejects invalid values in drafts", () => {
    expect(evaluateAnswers(demoDefinition, { overall_rating: 9 }, "draft").errors).toHaveLength(1);
  });

  it("shows a follow-up only when its condition holds", () => {
    expect(evaluateAnswers(demoDefinition, { ready_on_time: "no" }, "draft").visible).toContain("delay_detail");
    expect(evaluateAnswers(demoDefinition, { ready_on_time: "yes" }, "draft").visible).not.toContain("delay_detail");
    expect(evaluateAnswers(demoDefinition, {}, "draft").visible).not.toContain("delay_detail");
  });

  it("drops answers to hidden questions at submission and never scores them", () => {
    const result = submit({ ...positive, delay_detail: "Took two extra days" });
    expect(result.answers).not.toHaveProperty("delay_detail");
    expect(result.droppedHidden).toEqual(["delay_detail"]);
  });

  it("keeps hidden answers in a draft so changing an earlier answer loses nothing", () => {
    const draft = evaluateAnswers(demoDefinition, { ready_on_time: "yes", delay_detail: "Earlier text" }, "draft");
    expect(draft.answers.delay_detail).toBe("Earlier text");
  });

  it("does not block submission over an invalid answer to a hidden question", () => {
    const result = evaluateSubmission(demoDefinition, { ...positive, improve_areas: ["not_a_choice"] });
    expect(result.ok).toBe(true);
  });
});

describe("scoring (server-computed, SR-14)", () => {
  it("computes demo metrics from answers, unrounded", () => {
    const { outcomes } = submit(positive);
    expect(outcomes.evaluatorVersion).toBe(EVALUATOR_VERSION);
    // (4 + 4 + 3) / (4 + 4 + 4)
    expect(outcomes.metrics.service_index).toBeCloseTo(11 / 12, 12);
    expect(outcomes.metrics.on_time).toBe(1);
  });

  it("leaves a not-applicable choice out of the score instead of counting it as zero", () => {
    const { outcomes } = submit({ ...positive, service_aspects: { communication: "good", quality: "good", cleanliness: "na" } });
    expect(outcomes.metrics.service_index).toBeCloseTo(6 / 8, 12);
  });

  it("returns null, not zero, when too few items are scored", () => {
    const { outcomes } = submit({ ...positive, service_aspects: { communication: "good", quality: "na", cleanliness: "na" } });
    expect(outcomes.metrics.service_index).toBeNull();
  });

  it("gives identical outcomes for identical answers, whatever the source (AT-18)", () => {
    const online = submit(positive);
    const paper = submit(JSON.parse(JSON.stringify(positive)));
    expect(paper.outcomes).toEqual(online.outcomes);
  });
});

describe("alerts and suppression rules", () => {
  it("fires no alert for a positive submission", () => {
    const { outcomes } = submit(positive);
    expect(outcomes.alerts).toEqual([]);
    expect(outcomes.suppressions).toEqual([]);
  });

  it("returns every fired alert ordered by precedence", () => {
    const { outcomes } = submit({
      overall_rating: 1,
      ready_on_time: "no",
      service_aspects: { communication: "poor", quality: "poor", cleanliness: "fair" },
      recommend_score: 2,
    });
    expect(outcomes.alerts.map((a) => a.id)).toEqual(["low_overall", "low_service_index", "not_on_time"]);
    expect(outcomes.suppressions.map((s) => s.id)).toEqual(["hold_routine_mail"]);
  });

  it("uses inclusive thresholds exactly as written", () => {
    expect(submit({ ...positive, overall_rating: 2 }).outcomes.alerts.map((a) => a.id)).toContain("low_overall");
    expect(submit({ ...positive, overall_rating: 3 }).outcomes.alerts.map((a) => a.id)).not.toContain("low_overall");
  });

  it("does not fire a metric alert when the metric is null", () => {
    const outcomes = computeOutcomes(demoDefinition, { ...positive, service_aspects: { communication: "poor", quality: "na", cleanliness: "na" } });
    expect(outcomes.metrics.service_index).toBeNull();
    expect(outcomes.alerts.map((a) => a.id)).not.toContain("low_service_index");
  });
});
