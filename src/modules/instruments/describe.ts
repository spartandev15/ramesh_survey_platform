import type { Condition, Question } from "./definition";

const OPS: Record<string, string> = {
  equals: "is",
  not_equals: "is not",
  in: "is one of",
  not_in: "is not one of",
  includes: "includes",
  excludes: "does not include",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

/** Plain-language rendering of a condition, for review screens. */
export function describeCondition(condition: Condition): string {
  if ("all" in condition) return condition.all.map(wrap).join(" AND ");
  if ("any" in condition) return condition.any.map(wrap).join(" OR ");
  if ("not" in condition) return `NOT ${wrap(condition.not)}`;
  if ("metric" in condition) {
    if (!("value" in condition)) return `metric ${condition.metric} ${condition.op === "is_null" ? "has no value" : "has a value"}`;
    return `metric ${condition.metric} ${condition.op === "equals" ? "=" : OPS[condition.op]} ${condition.value}`;
  }
  const target = "row" in condition && condition.row ? `${condition.question}.${condition.row}` : condition.question;
  if ("values" in condition) return `${target} ${OPS[condition.op]} [${condition.values.join(", ")}]`;
  if (!("value" in condition)) return `${target} ${condition.op === "answered" ? "is answered" : "is not answered"}`;
  return `${target} ${OPS[condition.op]} ${condition.value}`;
}

function wrap(condition: Condition): string {
  const text = describeCondition(condition);
  return "all" in condition || "any" in condition ? `(${text})` : text;
}

export const QUESTION_TYPE_LABELS: Record<Question["type"], string> = {
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
  rating: "Rating",
  number: "Number",
  text: "Text",
  matrix: "Matrix",
};

/**
 * A stored answer as readable text, using option labels and keeping the
 * stable ID for traceability. `undefined` means skipped: never shown as zero.
 */
export function formatAnswer(question: Question, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const label = (options: { id: string; label: string }[], id: unknown) => {
    const found = options.find((o) => o.id === id);
    return found ? `${found.label} (${found.id})` : String(id);
  };
  switch (question.type) {
    case "single_choice":
      return label(question.choices, value);
    case "multi_choice":
      return Array.isArray(value) ? value.map((v) => label(question.choices, v)).join(", ") : String(value);
    case "matrix": {
      const cells = value as Record<string, string>;
      return question.rows
        .map((r) => `${r.label}: ${cells[r.id] !== undefined ? label(question.columns, cells[r.id]) : "skipped"}`)
        .join("; ");
    }
    default:
      return String(value);
  }
}
