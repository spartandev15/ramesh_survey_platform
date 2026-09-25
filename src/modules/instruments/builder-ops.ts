/**
 * Pure helpers behind the survey builder UI (SR-44). Kept separate from React
 * so the editing rules are unit-tested.
 */
import { allQuestions, type Choice, type ComparableValue, type Condition, type InstrumentDefinition, type Question, type QuestionType } from "./definition";

/** Next free id like `question_3`, never reusing an existing one. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = base.replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "") || "item";
  for (let n = 1; ; n++) {
    const candidate = `${stem}_${n}`.slice(0, 63);
    if (!used.has(candidate)) return candidate;
  }
}

export function definitionIds(definition: InstrumentDefinition) {
  return {
    pages: definition.pages.map((p) => p.id),
    questions: allQuestions(definition).map((q) => q.id),
    metrics: definition.metrics.map((m) => m.id),
    alerts: definition.alerts.map((a) => a.id),
    suppressions: definition.suppressions.map((s) => s.id),
  };
}

const defaultChoices = (): Choice[] => [
  { id: "choice_1", label: "Option 1" },
  { id: "choice_2", label: "Option 2" },
];

/** Type-specific fields with sensible starting values. */
function typeFields(type: QuestionType) {
  switch (type) {
    case "single_choice":
      return { type, display: "radio" as const, choices: defaultChoices() };
    case "multi_choice":
      return { type, choices: defaultChoices() };
    case "rating":
      return { type, min: 1, max: 5 };
    case "number":
      return { type, integer: false };
    case "text":
      return { type, multiline: false, maxLength: 2000 };
    case "matrix":
      return {
        type,
        rows: [
          { id: "row_1", label: "Row 1" },
          { id: "row_2", label: "Row 2" },
        ],
        columns: [
          { id: "col_1", label: "Column 1", value: 1 },
          { id: "col_2", label: "Column 2", value: 2 },
        ],
      };
  }
}

export function newQuestion(type: QuestionType, takenIds: Iterable<string>): Question {
  return { id: uniqueId("question", takenIds), title: "Untitled question", required: false, ...typeFields(type) } as Question;
}

/**
 * Change a question's type, keeping its id, text, requiredness and display
 * rule. Choice-based types keep their options when switching between them.
 */
export function convertQuestion(question: Question, type: QuestionType): Question {
  if (question.type === type) return question;
  const base = {
    id: question.id,
    title: question.title,
    description: question.description,
    required: question.required,
    visibleWhen: question.visibleWhen,
    sourceRef: question.sourceRef,
  };
  const fields = typeFields(type);
  const options = question.type === "single_choice" || question.type === "multi_choice" ? question.choices : question.type === "matrix" ? question.columns : null;
  if (options && (type === "single_choice" || type === "multi_choice")) return { ...base, ...fields, choices: options } as Question;
  if (options && type === "matrix") return { ...base, ...fields, columns: options } as Question;
  return { ...base, ...fields } as Question;
}

export function questionOptions(question: Question): Choice[] {
  if (question.type === "single_choice" || question.type === "multi_choice") return question.choices;
  if (question.type === "matrix") return question.columns;
  return [];
}

export function isNumericCapable(question: Question): boolean {
  if (question.type === "rating" || question.type === "number") return true;
  if (question.type === "single_choice" || question.type === "matrix") return questionOptions(question).some((c) => c.value !== undefined);
  return false;
}

// ---------------------------------------------------------------------------
// Conditions in the builder
// ---------------------------------------------------------------------------

export type LeafCondition = Exclude<Condition, { all: Condition[] } | { any: Condition[] } | { not: Condition }>;
export type ConditionOp = LeafCondition["op"];

/** What the builder's condition editor can show: none, one clause, or clauses joined by all/any. */
export type EditableCondition = { join: "all" | "any"; clauses: LeafCondition[] };

export function isLeaf(condition: Condition): condition is LeafCondition {
  return !("all" in condition) && !("any" in condition) && !("not" in condition);
}

/** Null when the condition is too complex for the form editor (edit it as JSON instead). */
export function toEditable(condition: Condition | undefined): EditableCondition | null {
  if (!condition) return { join: "all", clauses: [] };
  if (isLeaf(condition)) return { join: "all", clauses: [condition] };
  if ("all" in condition && condition.all.every(isLeaf)) return { join: "all", clauses: condition.all as LeafCondition[] };
  if ("any" in condition && condition.any.every(isLeaf)) return { join: "any", clauses: condition.any as LeafCondition[] };
  return null;
}

export function fromEditable(editable: EditableCondition): Condition | undefined {
  if (editable.clauses.length === 0) return undefined;
  if (editable.clauses.length === 1) return editable.clauses[0];
  return editable.join === "all" ? { all: editable.clauses } : { any: editable.clauses };
}

export const OP_LABELS: Record<ConditionOp, string> = {
  answered: "is answered",
  not_answered: "is not answered",
  equals: "is",
  not_equals: "is not",
  in: "is one of",
  not_in: "is not one of",
  includes: "includes",
  excludes: "does not include",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  is_null: "has no value",
  not_null: "has a value",
};

const NUMERIC_OPS = ["gt", "gte", "lt", "lte"] as const;

/** Operators that make sense for a question (or one matrix row) in the builder. */
export function opsForQuestion(question: Question): ConditionOp[] {
  const presence: ConditionOp[] = ["answered", "not_answered"];
  switch (question.type) {
    case "text":
      return presence;
    case "multi_choice":
      return [...presence, "includes", "excludes"];
    case "rating":
    case "number":
      return [...presence, "equals", "not_equals", ...NUMERIC_OPS];
    case "single_choice":
    case "matrix":
      return [...presence, "equals", "not_equals", "in", "not_in", ...(isNumericCapable(question) ? NUMERIC_OPS : [])];
  }
}

export const METRIC_OPS: ConditionOp[] = ["lt", "lte", "gt", "gte", "equals", "is_null", "not_null"];

/** A valid starting clause for a question, used when the user picks a new source. */
export function defaultClauseForQuestion(question: Question): LeafCondition {
  const row = question.type === "matrix" ? question.rows[0]?.id : undefined;
  const firstOption = questionOptions(question)[0]?.id;
  if (question.type === "text") return { question: question.id, op: "answered" };
  if (question.type === "multi_choice") return { question: question.id, op: "includes", value: firstOption ?? "" };
  if (question.type === "rating") return { question: question.id, op: "lte", value: question.min };
  if (question.type === "number") return { question: question.id, op: "equals", value: question.min ?? 0 };
  return { question: question.id, ...(row ? { row } : {}), op: "equals", value: firstOption ?? "" };
}

export function defaultClauseForMetric(metricId: string): LeafCondition {
  return { metric: metricId, op: "lt", value: 0 };
}

/** Rebuild a clause for a new operator, carrying over a compatible value. */
export function changeOp(clause: LeafCondition, op: ConditionOp, question: Question | undefined): LeafCondition {
  if ("metric" in clause) {
    if (op === "is_null" || op === "not_null") return { metric: clause.metric, op };
    const value = "value" in clause ? clause.value : 0;
    return { metric: clause.metric, op: op as "lt", value };
  }
  const base = { question: clause.question, ...("row" in clause && clause.row ? { row: clause.row } : {}) };
  const firstOption = question ? questionOptions(question)[0]?.id : undefined;
  const current: ComparableValue | undefined = "value" in clause ? clause.value : "values" in clause ? clause.values[0] : undefined;

  switch (op) {
    case "answered":
    case "not_answered":
      return { ...base, op };
    case "in":
    case "not_in":
      return { ...base, op, values: current !== undefined ? [current] : firstOption ? [firstOption] : [] };
    case "includes":
    case "excludes":
      return { question: clause.question, op, value: typeof current === "string" ? current : (firstOption ?? "") };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { ...base, op, value: typeof current === "number" ? current : question?.type === "rating" ? question.min : 0 };
    default: {
      const numeric = question?.type === "rating" || question?.type === "number";
      const value = numeric ? (typeof current === "number" ? current : 0) : typeof current === "string" ? current : (firstOption ?? "");
      return { ...base, op: op as "equals", value };
    }
  }
}

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Ids that other parts of the definition refer to, so the builder can warn before deleting a question. */
export function questionReferences(definition: InstrumentDefinition, questionId: string): string[] {
  const refs: string[] = [];
  const mentions = (c: Condition | undefined): boolean => {
    if (!c) return false;
    if ("all" in c) return c.all.some(mentions);
    if ("any" in c) return c.any.some(mentions);
    if ("not" in c) return mentions(c.not);
    return "question" in c && c.question === questionId;
  };
  for (const q of allQuestions(definition)) {
    if (q.id !== questionId && (mentions(q.visibleWhen) || (typeof q.required === "object" && mentions(q.required)))) refs.push(`question ${q.id}`);
  }
  for (const m of definition.metrics) if (m.items.some((i) => i.question === questionId)) refs.push(`metric ${m.id}`);
  for (const a of definition.alerts) if (mentions(a.when)) refs.push(`alert ${a.id}`);
  for (const s of definition.suppressions) if (mentions(s.when)) refs.push(`suppression ${s.id}`);
  return refs;
}

export interface QuestionPosition {
  page: number;
  index: number;
}

/**
 * Move a question within or across pages. `to.index` is the position in the
 * destination page after the question is taken out (drag-and-drop semantics).
 * Returns the question's final position.
 */
export function moveQuestion(definition: InstrumentDefinition, from: QuestionPosition, to: QuestionPosition): QuestionPosition {
  const source = definition.pages[from.page]?.questions;
  const target = definition.pages[to.page]?.questions;
  if (!source || !target || !source[from.index]) return from;
  const [question] = source.splice(from.index, 1);
  const index = Math.max(0, Math.min(to.index, target.length));
  target.splice(index, 0, question);
  return { page: to.page, index };
}

/** Insert a question at a position (clamped to the page). Returns its final position. */
export function insertQuestion(definition: InstrumentDefinition, question: Question, at: QuestionPosition): QuestionPosition {
  const target = definition.pages[at.page]?.questions;
  if (!target) return at;
  const index = Math.max(0, Math.min(at.index, target.length));
  target.splice(index, 0, question);
  return { page: at.page, index };
}
