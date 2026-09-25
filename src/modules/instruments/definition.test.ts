import { describe, expect, it } from "vitest";
import { demoDefinition } from "./demo-definition";
import { DEFINITION_SCHEMA_VERSION, emptyDefinition, parseDefinition, validateDefinition, type InstrumentDefinition } from "./definition";

function withPages(pages: unknown, extra: Record<string, unknown> = {}): InstrumentDefinition {
  const parsed = parseDefinition({ schemaVersion: DEFINITION_SCHEMA_VERSION, pages, ...extra });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.definition;
}

const yesNo = (id: string) => ({
  id,
  type: "single_choice",
  title: id,
  choices: [
    { id: "yes", label: "Yes", value: 1 },
    { id: "no", label: "No", value: 0 },
  ],
});

describe("definition shape", () => {
  it("accepts the demo definition with no semantic issues", () => {
    expect(parseDefinition(demoDefinition).ok).toBe(true);
    expect(validateDefinition(demoDefinition)).toEqual([]);
  });

  it("rejects script-like or unknown keys, so no executable code can enter a definition", () => {
    const result = parseDefinition({
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      pages: [{ id: "p", questions: [{ ...yesNo("q1"), onChange: "fetch('https://evil')" }] }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unsafe stable ids", () => {
    const result = parseDefinition({ schemaVersion: DEFINITION_SCHEMA_VERSION, pages: [{ id: "p", questions: [yesNo("Bad Id")] }] });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown schema version", () => {
    expect(parseDefinition({ schemaVersion: 99, pages: [] }).ok).toBe(false);
  });
});

describe("semantic validation before publishing", () => {
  it("requires at least one question", () => {
    expect(validateDefinition(emptyDefinition()).map((i) => i.message)).toContain("Add at least one question");
  });

  it("rejects duplicate question ids across pages", () => {
    const def = withPages([
      { id: "a", questions: [yesNo("q1")] },
      { id: "b", questions: [yesNo("q1")] },
    ]);
    expect(validateDefinition(def).some((i) => i.message.includes('Question id "q1"'))).toBe(true);
  });

  it("only lets display rules reference earlier questions", () => {
    const def = withPages([
      {
        id: "p",
        questions: [
          { ...yesNo("q1"), visibleWhen: { question: "q2", op: "equals", value: "yes" } },
          yesNo("q2"),
        ],
      },
    ]);
    expect(validateDefinition(def).some((i) => i.message.includes("must come earlier"))).toBe(true);
  });

  it("rejects a condition value that is not a choice", () => {
    const def = withPages([{ id: "p", questions: [yesNo("q1"), { ...yesNo("q2"), visibleWhen: { question: "q1", op: "equals", value: "maybe" } }] }]);
    expect(validateDefinition(def).some((i) => i.message.includes('"maybe" is not a choice'))).toBe(true);
  });

  it("does not allow metrics inside display rules", () => {
    const def = withPages([{ id: "p", questions: [yesNo("q1"), { ...yesNo("q2"), visibleWhen: { metric: "m", op: "lt", value: 1 } }] }], {
      metrics: [{ id: "m", label: "M", method: "mean", items: [{ question: "q1" }] }],
    });
    expect(validateDefinition(def).some((i) => i.message.includes("Metrics can only be used"))).toBe(true);
  });

  it("requires numeric values for scored choice questions", () => {
    const def = withPages([{ id: "p", questions: [{ id: "q1", type: "single_choice", title: "Q", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }] }], {
      metrics: [{ id: "m", label: "M", method: "mean", items: [{ question: "q1" }] }],
    });
    expect(validateDefinition(def).some((i) => i.message.includes("no numeric value"))).toBe(true);
  });

  it("requires matrix rows in conditions and metrics", () => {
    const def = withPages(
      [{ id: "p", questions: [{ id: "grid", type: "matrix", title: "G", rows: [{ id: "r1", label: "R1" }], columns: [{ id: "a", label: "A", value: 1 }, { id: "b", label: "B", value: 2 }] }] }],
      {
        metrics: [{ id: "m", label: "M", method: "mean", items: [{ question: "grid" }] }],
        alerts: [{ id: "x", label: "X", precedence: 1, when: { question: "grid", op: "equals", value: "a" } }],
      },
    );
    const messages = validateDefinition(def).map((i) => i.message);
    expect(messages.some((m) => m.includes("valid row"))).toBe(true);
    expect(messages.some((m) => m.includes("Choose a row"))).toBe(true);
  });

  it("rejects alerts sharing a precedence, so the primary alert is never ambiguous", () => {
    const def = withPages([{ id: "p", questions: [yesNo("q1")] }], {
      alerts: [
        { id: "a", label: "A", precedence: 1, when: { question: "q1", op: "equals", value: "no" } },
        { id: "b", label: "B", precedence: 1, when: { question: "q1", op: "equals", value: "yes" } },
      ],
    });
    expect(validateDefinition(def).some((i) => i.message.includes("share precedence"))).toBe(true);
  });

  it("flags unknown metrics in alert rules", () => {
    const def = withPages([{ id: "p", questions: [yesNo("q1")] }], {
      alerts: [{ id: "a", label: "A", precedence: 1, when: { metric: "missing", op: "lt", value: 1 } }],
    });
    expect(validateDefinition(def).some((i) => i.message.includes('Unknown metric "missing"'))).toBe(true);
  });
});
