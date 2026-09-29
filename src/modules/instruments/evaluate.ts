/**
 * Server-side evaluator for instrument definitions (SR-14, SR-17, SR-18).
 *
 * Online, public and paper responses all go through these functions, so
 * identical answers always produce identical outcomes (AT-18). Scores and
 * alert classes are computed here, never accepted from a client (PDF 05).
 *
 * Answer policy (PDF 05, answer contract):
 * - An absent key is a skip. Skip is never zero.
 * - Only allowed types, lengths, ranges and options are accepted.
 * - Visibility and requiredness are re-evaluated on the server at submission.
 * - Answers to questions hidden at submission are omitted from the submitted
 *   set and never scored (the PDF's proposed policy).
 */
import type { ComparableValue, Condition, InstrumentDefinition, Metric, Question } from "./definition";
import { allQuestions, maxItemValue } from "./questions";

/**
 * Bump when evaluation semantics change. Stored with every outcome so a
 * historical score can always be traced to the rules that produced it (AT-15).
 */
export const EVALUATOR_VERSION = 1;

export type AnswerValue = string | number | string[] | Record<string, string>;
export type Answers = Record<string, AnswerValue>;

export type AnswerErrorCode = "unknown_question" | "invalid" | "required";

export interface AnswerError {
  questionId: string;
  code: AnswerErrorCode;
  message: string;
}

export interface EvaluatedAnswers {
  /** Valid answers. Submit mode: visible questions only. Draft mode: also keeps hidden answers. */
  answers: Answers;
  /** Question ids visible for these answers, in survey order. */
  visible: string[];
  /** Answers omitted because their question was hidden (submit mode). */
  droppedHidden: string[];
  errors: AnswerError[];
}

export interface Outcomes {
  evaluatorVersion: number;
  /** Unrounded metric values; null means not enough answers, never zero. */
  metrics: Record<string, number | null>;
  /** Fired alert rules, highest priority (lowest precedence number) first. */
  alerts: { id: string; label: string; precedence: number }[];
  /** Fired routine-mail suppression rules. Creating one is not applying it (SR-36). */
  suppressions: { id: string; label: string }[];
}

// ---------------------------------------------------------------------------
// Answer normalization
// ---------------------------------------------------------------------------

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

type Normalized = { ok: true; value: AnswerValue } | { ok: false; message: string };

/** Check one non-blank answer against its question. */
function normalizeAnswer(question: Question, raw: unknown): Normalized {
  switch (question.type) {
    case "single_choice": {
      if (typeof raw !== "string" || !question.choices.some((c) => c.id === raw)) return { ok: false, message: "Choose one of the listed options" };
      return { ok: true, value: raw };
    }
    case "multi_choice": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) return { ok: false, message: "Choose from the listed options" };
      const allowed = new Set(question.choices.map((c) => c.id));
      const picked = raw as string[];
      if (picked.some((v) => !allowed.has(v))) return { ok: false, message: "Choose from the listed options" };
      if (new Set(picked).size !== picked.length) return { ok: false, message: "Each option can be chosen once" };
      if (question.minSelected !== undefined && picked.length < question.minSelected) return { ok: false, message: `Choose at least ${question.minSelected}` };
      if (question.maxSelected !== undefined && picked.length > question.maxSelected) return { ok: false, message: `Choose at most ${question.maxSelected}` };
      // Keep definition order so equal selections are stored identically.
      return { ok: true, value: question.choices.map((c) => c.id).filter((id) => picked.includes(id)) };
    }
    case "rating": {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < question.min || raw > question.max) {
        return { ok: false, message: `Choose a rating from ${question.min} to ${question.max}` };
      }
      return { ok: true, value: raw };
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return { ok: false, message: "Enter a number" };
      if (question.integer && !Number.isInteger(raw)) return { ok: false, message: "Enter a whole number" };
      if (question.min !== undefined && raw < question.min) return { ok: false, message: `Enter ${question.min} or more` };
      if (question.max !== undefined && raw > question.max) return { ok: false, message: `Enter ${question.max} or less` };
      return { ok: true, value: raw };
    }
    case "text": {
      if (typeof raw !== "string") return { ok: false, message: "Enter text" };
      const value = raw.trim();
      if (value.length > question.maxLength) return { ok: false, message: `Use ${question.maxLength} characters or fewer` };
      return { ok: true, value };
    }
    case "matrix": {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, message: "Answer each row with one option" };
      const rows = new Set(question.rows.map((r) => r.id));
      const columns = new Set(question.columns.map((c) => c.id));
      const cells: Record<string, string> = {};
      for (const [row, column] of Object.entries(raw as Record<string, unknown>)) {
        if (!rows.has(row)) return { ok: false, message: "Answer only the listed rows" };
        if (column === undefined || column === null || column === "") continue;
        if (typeof column !== "string" || !columns.has(column)) return { ok: false, message: "Answer each row with one of the listed options" };
        cells[row] = column;
      }
      return { ok: true, value: cells };
    }
  }
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** The raw answer a condition refers to (a matrix cell when `row` is set). */
function conditionAnswer(answers: Answers, questionId: string, row?: string): AnswerValue | undefined {
  const value = answers[questionId];
  if (row === undefined) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) return (value as Record<string, string>)[row];
  return undefined;
}

/** Numeric value of a scalar answer: the number itself, or the chosen option's value. */
function numericValue(question: Question | undefined, answer: AnswerValue | undefined): number | null {
  if (!question || answer === undefined) return null;
  if (typeof answer === "number") return answer;
  if (typeof answer !== "string") return null;
  const options = question.type === "single_choice" ? question.choices : question.type === "matrix" ? question.columns : [];
  return options.find((c) => c.id === answer)?.value ?? null;
}

function compare(op: "gt" | "gte" | "lt" | "lte" | "equals", left: number, right: number): boolean {
  switch (op) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "equals":
      return left === right;
  }
}

interface ConditionContext {
  questions: Map<string, Question>;
  /** Answers that count for conditions: hidden questions are treated as unanswered. */
  answers: Answers;
  metrics?: Record<string, number | null>;
}

/**
 * Every value comparison is false for an unanswered question, including
 * not_equals and not_in; use not_answered to test for a skip.
 */
export function evaluateCondition(condition: Condition, ctx: ConditionContext): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(c, ctx));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(c, ctx));
  if ("not" in condition) return !evaluateCondition(condition.not, ctx);

  if ("metric" in condition) {
    const value = ctx.metrics?.[condition.metric] ?? null;
    if (condition.op === "is_null") return value === null;
    if (condition.op === "not_null") return value !== null;
    return "value" in condition && value !== null && compare(condition.op, value, condition.value);
  }

  const answer = conditionAnswer(ctx.answers, condition.question, "row" in condition ? condition.row : undefined);
  const answered = !isBlank(answer);
  if (condition.op === "answered") return answered;
  if (condition.op === "not_answered") return !answered;
  if (!answered) return false;

  const matches = (v: ComparableValue) => answer === v;
  switch (condition.op) {
    case "equals":
      return matches(condition.value);
    case "not_equals":
      return !matches(condition.value);
    case "in":
      return condition.values.some(matches);
    case "not_in":
      return !condition.values.some(matches);
    case "includes":
      return Array.isArray(answer) && answer.includes(condition.value);
    case "excludes":
      return Array.isArray(answer) && !answer.includes(condition.value);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const value = numericValue(ctx.questions.get(condition.question), answer);
      return value !== null && compare(condition.op, value, condition.value);
    }
  }
}

// ---------------------------------------------------------------------------
// Answers → validated set
// ---------------------------------------------------------------------------

/**
 * Validate answers against a definition.
 *
 * - "draft": type-checks what is present; skips requiredness. Hidden answers
 *   are kept so a respondent who changes an earlier answer does not lose them.
 * - "submit": also enforces requiredness and omits hidden answers.
 */
export function evaluateAnswers(definition: InstrumentDefinition, input: unknown, mode: "draft" | "submit"): EvaluatedAnswers {
  const questions = allQuestions(definition);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const errors: AnswerError[] = [];
  const raw: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input))) {
    errors.push({ questionId: "(root)", code: "invalid", message: "Answers must be an object keyed by question id" });
  }
  for (const key of Object.keys(raw)) {
    if (!byId.has(key)) errors.push({ questionId: key, code: "unknown_question", message: "This question is not part of the survey version" });
  }

  const answers: Answers = {};
  const visibleAnswers: Answers = {};
  const visible: string[] = [];
  const droppedHidden: string[] = [];

  for (const question of questions) {
    const ctx: ConditionContext = { questions: byId, answers: visibleAnswers };
    const isVisible = question.visibleWhen ? evaluateCondition(question.visibleWhen, ctx) : true;
    const value = raw[question.id];
    const blank = isBlank(value);

    let normalized: AnswerValue | undefined;
    let invalid: string | null = null;
    if (!blank) {
      const result = normalizeAnswer(question, value);
      if (result.ok) normalized = isBlank(result.value) ? undefined : result.value;
      else invalid = result.message;
    }

    if (!isVisible) {
      // A hidden answer never scores, so at submission it is dropped rather than blocking the respondent.
      if (mode === "submit") {
        if (!blank) droppedHidden.push(question.id);
        continue;
      }
      if (invalid) errors.push({ questionId: question.id, code: "invalid", message: invalid });
      else if (normalized !== undefined) answers[question.id] = normalized;
      continue;
    }

    if (invalid) errors.push({ questionId: question.id, code: "invalid", message: invalid });

    visible.push(question.id);
    if (normalized !== undefined) {
      answers[question.id] = normalized;
      visibleAnswers[question.id] = normalized;
    }

    if (mode === "submit") {
      const required = typeof question.required === "boolean" ? question.required : evaluateCondition(question.required, ctx);
      if (!required) continue;
      const hasError = errors.some((e) => e.questionId === question.id);
      if (hasError) continue;
      if (normalized === undefined) {
        errors.push({ questionId: question.id, code: "required", message: "This question needs an answer" });
      } else if (question.type === "matrix") {
        const cells = normalized as Record<string, string>;
        if (question.rows.some((r) => cells[r.id] === undefined)) {
          errors.push({ questionId: question.id, code: "required", message: "Answer every row" });
        }
      }
    }
  }

  return { answers, visible, droppedHidden, errors };
}

// ---------------------------------------------------------------------------
// Scoring and rules
// ---------------------------------------------------------------------------

function computeMetric(metric: Metric, questions: Map<string, Question>, answers: Answers): number | null {
  let answered = 0;
  let missing = 0;
  let weighted = 0;
  let weights = 0;
  let maxTotal = 0;

  for (const item of metric.items) {
    const question = questions.get(item.question);
    const answer = conditionAnswer(answers, item.question, item.row);
    if (!question || isBlank(answer)) {
      missing += 1;
      continue;
    }

    if (metric.method === "share_matching") {
      answered += 1;
      weights += item.weight;
      if (metric.matchValues?.some((v) => v === answer)) weighted += item.weight;
      continue;
    }

    const value = numericValue(question, answer);
    if (value === null) {
      // A choice without a scoring value (e.g. "Not applicable") counts as not scored.
      missing += 1;
      continue;
    }
    answered += 1;
    weighted += value * item.weight;
    weights += item.weight;
    maxTotal += (maxItemValue(question) ?? 0) * item.weight;
  }

  if (metric.missing === "null_if_any_missing" && missing > 0) return null;
  if (answered < metric.minAnswered || answered === 0) return null;

  switch (metric.method) {
    case "mean":
      return weighted / weights;
    case "sum":
      return weighted;
    case "ratio_of_max":
      return maxTotal > 0 ? weighted / maxTotal : null;
    case "share_matching":
      return weighted / weights;
  }
}

/** Compute metrics and fired rules from a validated submitted answer set. */
export function computeOutcomes(definition: InstrumentDefinition, answers: Answers): Outcomes {
  const questions = new Map(allQuestions(definition).map((q) => [q.id, q]));
  const metrics: Record<string, number | null> = {};
  for (const metric of definition.metrics) metrics[metric.id] = computeMetric(metric, questions, answers);

  const ctx: ConditionContext = { questions, answers, metrics };
  const alerts = definition.alerts
    .filter((rule) => evaluateCondition(rule.when, ctx))
    .map((rule) => ({ id: rule.id, label: rule.label, precedence: rule.precedence }))
    .sort((a, b) => a.precedence - b.precedence);
  const suppressions = definition.suppressions
    .filter((rule) => evaluateCondition(rule.when, ctx))
    .map((rule) => ({ id: rule.id, label: rule.label }));

  return { evaluatorVersion: EVALUATOR_VERSION, metrics, alerts, suppressions };
}

export type SubmissionResult =
  | { ok: true; answers: Answers; droppedHidden: string[]; outcomes: Outcomes }
  | { ok: false; errors: AnswerError[] };

/** Validate a submission and compute its outcomes. The single path for online, public and paper entry. */
export function evaluateSubmission(definition: InstrumentDefinition, input: unknown): SubmissionResult {
  const evaluated = evaluateAnswers(definition, input, "submit");
  if (evaluated.errors.length > 0) return { ok: false, errors: evaluated.errors };
  return { ok: true, answers: evaluated.answers, droppedHidden: evaluated.droppedHidden, outcomes: computeOutcomes(definition, evaluated.answers) };
}
