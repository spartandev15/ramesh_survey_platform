/**
 * Survey instrument definition: questions, conditional display, scoring,
 * alert and routine-mail suppression rules in one versioned JSON document.
 *
 * PDF references:
 * - SR-14 / SR-15: stable question IDs; published versions are immutable.
 * - 04 technical design, renderer decision: no client-executable scripts or
 *   remote callbacks in administrator-entered definitions. Every rule here is
 *   declarative data evaluated by the server.
 * - 05 answer contract: choice ID, choice-ID array, text, numeric value or
 *   structured matrix cells.
 * - question-catalog.csv: each record kind (question, score_rule, alert_rule,
 *   suppression_rule) has a place here, including a source locator.
 *
 * Pure module with no I/O so the same code validates on the server and
 * previews in the browser.
 */
import { z } from "zod";

export const DEFINITION_SCHEMA_VERSION = 1;

/** Stable, human-readable IDs. They are exported and reported, so they never change once published. */
const stableId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,62}$/, "Use lowercase letters, numbers and underscores, starting with a letter");

const text = (max: number) => z.string().trim().min(1, "Required").max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Where this item came from in the approved source (question-catalog.csv source_locator). */
const sourceRef = optionalText(500);

// ---------------------------------------------------------------------------
// Conditions: a small declarative language. No expressions, no scripts.
// ---------------------------------------------------------------------------

export type ComparableValue = string | number;
export type NumericOp = "gt" | "gte" | "lt" | "lte";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { question: string; row?: string; op: "answered" | "not_answered" }
  | { question: string; row?: string; op: "equals" | "not_equals"; value: ComparableValue }
  | { question: string; row?: string; op: "in" | "not_in"; values: ComparableValue[] }
  | { question: string; op: "includes" | "excludes"; value: string }
  | { question: string; row?: string; op: NumericOp; value: number }
  | { metric: string; op: NumericOp | "equals"; value: number }
  | { metric: string; op: "is_null" | "not_null" };

const comparable = z.union([z.string().max(200), z.number().finite()]);
const numericOp = z.enum(["gt", "gte", "lt", "lte"]);

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(conditionSchema).min(1).max(50) }),
    z.strictObject({ any: z.array(conditionSchema).min(1).max(50) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({ question: stableId, row: stableId.optional(), op: z.enum(["answered", "not_answered"]) }),
    z.strictObject({ question: stableId, row: stableId.optional(), op: z.enum(["equals", "not_equals"]), value: comparable }),
    z.strictObject({ question: stableId, row: stableId.optional(), op: z.enum(["in", "not_in"]), values: z.array(comparable).min(1).max(100) }),
    z.strictObject({ question: stableId, op: z.enum(["includes", "excludes"]), value: stableId }),
    z.strictObject({ question: stableId, row: stableId.optional(), op: numericOp, value: z.number().finite() }),
    z.strictObject({ metric: stableId, op: z.enum(["gt", "gte", "lt", "lte", "equals"]), value: z.number().finite() }),
    z.strictObject({ metric: stableId, op: z.enum(["is_null", "not_null"]) }),
  ]),
);

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const choiceSchema = z.strictObject({
  id: stableId,
  label: text(300),
  /** Numeric value used by scoring and numeric conditions. Omit for choices that never score. */
  value: z.number().finite().optional(),
});

const baseQuestion = {
  id: stableId,
  title: text(1000),
  description: optionalText(2000),
  /** `true`, `false`, or a condition. Only applies while the question is visible. */
  required: z.union([z.boolean(), conditionSchema]).default(false),
  visibleWhen: conditionSchema.optional(),
  sourceRef,
};

const singleChoiceQuestion = z.strictObject({
  ...baseQuestion,
  type: z.literal("single_choice"),
  display: z.enum(["radio", "dropdown"]).default("radio"),
  choices: z.array(choiceSchema).min(2).max(50),
});

const multiChoiceQuestion = z.strictObject({
  ...baseQuestion,
  type: z.literal("multi_choice"),
  choices: z.array(choiceSchema).min(2).max(50),
  minSelected: z.number().int().min(1).optional(),
  maxSelected: z.number().int().min(1).optional(),
});

const ratingQuestion = z.strictObject({
  ...baseQuestion,
  type: z.literal("rating"),
  min: z.number().int().min(0).max(100),
  max: z.number().int().min(1).max(100),
  minLabel: optionalText(100),
  maxLabel: optionalText(100),
});

const numberQuestion = z.strictObject({
  ...baseQuestion,
  type: z.literal("number"),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  integer: z.boolean().default(false),
});

const textQuestion = z.strictObject({
  ...baseQuestion,
  type: z.literal("text"),
  multiline: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(10000).default(2000),
});

const matrixQuestion = z.strictObject({
  ...baseQuestion,
  type: z.literal("matrix"),
  rows: z.array(z.strictObject({ id: stableId, label: text(300) })).min(1).max(50),
  /** Every row is answered with one column. Column values drive scoring. */
  columns: z.array(choiceSchema).min(2).max(20),
});

export const questionSchema = z.discriminatedUnion("type", [
  singleChoiceQuestion,
  multiChoiceQuestion,
  ratingQuestion,
  numberQuestion,
  textQuestion,
  matrixQuestion,
]);

export type Question = z.infer<typeof questionSchema>;
export type QuestionType = Question["type"];
export type Choice = z.infer<typeof choiceSchema>;

const pageSchema = z.strictObject({
  id: stableId,
  title: optionalText(300),
  questions: z.array(questionSchema).max(200),
});

// ---------------------------------------------------------------------------
// Scoring, alerts and routine-mail suppression
// ---------------------------------------------------------------------------

const metricItemSchema = z.strictObject({
  question: stableId,
  /** Required for matrix questions: which row is scored. */
  row: stableId.optional(),
  weight: z.number().finite().positive().default(1),
});

/**
 * Supported formulas. Results are stored unrounded; display rounding never
 * changes stored values or alert thresholds (PDF 04, metrics and reporting).
 *
 * - mean:           weighted mean of answered item values
 * - sum:            weighted sum of answered item values
 * - ratio_of_max:   weighted sum / weighted sum of each item's maximum value (0..1)
 * - share_matching: share of answered items whose answer is in `matchValues` (0..1)
 *
 * If the approved PSG formula needs another method, add it here as code with
 * tests. A new method never changes how an existing published version scores.
 */
const metricSchema = z.strictObject({
  id: stableId,
  label: text(200),
  method: z.enum(["mean", "sum", "ratio_of_max", "share_matching"]),
  items: z.array(metricItemSchema).min(1).max(100),
  matchValues: z.array(comparable).min(1).max(100).optional(),
  /** ignore: skipped items are left out. null_if_any_missing: any skipped item makes the metric null. */
  missing: z.enum(["ignore", "null_if_any_missing"]).default("ignore"),
  /** Fewer answered items than this makes the metric null. Null is missing, never zero. */
  minAnswered: z.number().int().min(1).default(1),
  sourceRef,
});

const alertRuleSchema = z.strictObject({
  id: stableId,
  label: text(200),
  when: conditionSchema,
  /** Lower number wins when several alerts fire (question-catalog.csv alert_precedence). */
  precedence: z.number().int().min(0).max(1000),
  sourceRef,
});

/** A rule outcome that requires a routine-mail suppression action (SR-36). Not proof it was applied. */
const suppressionRuleSchema = z.strictObject({
  id: stableId,
  label: text(200),
  when: conditionSchema,
  sourceRef,
});

export const definitionSchema = z.strictObject({
  schemaVersion: z.literal(DEFINITION_SCHEMA_VERSION),
  /** Short text shown to respondents above the first page. */
  intro: optionalText(2000),
  pages: z.array(pageSchema).max(50),
  metrics: z.array(metricSchema).max(50).default([]),
  alerts: z.array(alertRuleSchema).max(50).default([]),
  suppressions: z.array(suppressionRuleSchema).max(50).default([]),
});

export type InstrumentDefinition = z.infer<typeof definitionSchema>;
export type Metric = z.infer<typeof metricSchema>;
export type AlertRule = z.infer<typeof alertRuleSchema>;
export type SuppressionRule = z.infer<typeof suppressionRuleSchema>;

export function allQuestions(definition: InstrumentDefinition): Question[] {
  return definition.pages.flatMap((page) => page.questions);
}

// ---------------------------------------------------------------------------
// Semantic validation (required before publishing)
// ---------------------------------------------------------------------------

export interface DefinitionIssue {
  path: string;
  message: string;
}

/**
 * Whether answers can carry a numeric value for scoring and numeric conditions.
 * Choices without a value (e.g. "Not applicable") are allowed and never score.
 */
function numericCapable(question: Question): boolean {
  switch (question.type) {
    case "rating":
    case "number":
      return true;
    case "single_choice":
      return question.choices.some((c) => c.value !== undefined);
    case "matrix":
      return question.columns.some((c) => c.value !== undefined);
    default:
      return false;
  }
}

/** Largest value an item can score; needed by ratio_of_max. */
export function maxItemValue(question: Question): number | null {
  switch (question.type) {
    case "rating":
      return question.max;
    case "number":
      return question.max ?? null;
    case "single_choice":
      return Math.max(...question.choices.map((c) => c.value ?? Number.NEGATIVE_INFINITY));
    case "matrix":
      return Math.max(...question.columns.map((c) => c.value ?? Number.NEGATIVE_INFINITY));
    default:
      return null;
  }
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}

interface ConditionScope {
  /** Questions the condition may reference, by id. */
  questions: Map<string, Question>;
  /** Metric ids the condition may reference, or null where metrics are not allowed. */
  metrics: Set<string> | null;
  /** Explains a missing question, e.g. that it must come earlier. */
  missingQuestionHint: string;
}

function checkCondition(condition: Condition, scope: ConditionScope, path: string, issues: DefinitionIssue[]) {
  if ("all" in condition || "any" in condition) {
    const list = "all" in condition ? condition.all : condition.any;
    list.forEach((c, i) => checkCondition(c, scope, `${path}.${"all" in condition ? "all" : "any"}[${i}]`, issues));
    return;
  }
  if ("not" in condition) {
    checkCondition(condition.not, scope, `${path}.not`, issues);
    return;
  }
  if ("metric" in condition) {
    if (!scope.metrics) issues.push({ path, message: "Metrics can only be used in alert and suppression rules" });
    else if (!scope.metrics.has(condition.metric)) issues.push({ path, message: `Unknown metric "${condition.metric}"` });
    return;
  }

  const question = scope.questions.get(condition.question);
  if (!question) {
    issues.push({ path, message: `Question "${condition.question}" ${scope.missingQuestionHint}` });
    return;
  }

  const row = "row" in condition ? condition.row : undefined;
  if (question.type === "matrix") {
    if (!row) issues.push({ path, message: `Choose a row of matrix question "${question.id}"` });
    else if (!question.rows.some((r) => r.id === row)) issues.push({ path, message: `Unknown row "${row}" in "${question.id}"` });
  } else if (row) {
    issues.push({ path, message: `"${question.id}" is not a matrix question, so it has no rows` });
  }

  const choiceIds = new Set(
    question.type === "single_choice" || question.type === "multi_choice"
      ? question.choices.map((c) => c.id)
      : question.type === "matrix"
        ? question.columns.map((c) => c.id)
        : [],
  );
  const checkValue = (value: ComparableValue) => {
    if (choiceIds.size > 0 && question.type !== "multi_choice") {
      if (typeof value !== "string" || !choiceIds.has(value)) issues.push({ path, message: `"${value}" is not a choice of "${question.id}"` });
    } else if ((question.type === "rating" || question.type === "number") && typeof value !== "number") {
      issues.push({ path, message: `"${question.id}" takes a number` });
    } else if (question.type === "text") {
      issues.push({ path, message: `Text question "${question.id}" can only be checked for answered / not answered` });
    }
  };

  switch (condition.op) {
    case "answered":
    case "not_answered":
      return;
    case "equals":
    case "not_equals":
      if (question.type === "multi_choice") issues.push({ path, message: `Use includes / excludes for multi-choice "${question.id}"` });
      else checkValue(condition.value);
      return;
    case "in":
    case "not_in":
      if (question.type === "multi_choice") issues.push({ path, message: `Use includes / excludes for multi-choice "${question.id}"` });
      else condition.values.forEach(checkValue);
      return;
    case "includes":
    case "excludes":
      if (question.type !== "multi_choice") issues.push({ path, message: `includes / excludes only apply to multi-choice questions` });
      else if (!choiceIds.has(condition.value)) issues.push({ path, message: `"${condition.value}" is not a choice of "${question.id}"` });
      return;
    default:
      if (!numericCapable(question)) issues.push({ path, message: `"${question.id}" has no numeric value to compare; give its choices values` });
  }
}

/**
 * Cross-reference checks the schema alone cannot express. A draft may be saved
 * with issues; publishing requires none.
 */
export function validateDefinition(definition: InstrumentDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const questions = allQuestions(definition);

  if (questions.length === 0) issues.push({ path: "pages", message: "Add at least one question" });
  definition.pages.forEach((page, i) => {
    if (page.questions.length === 0) issues.push({ path: `pages[${i}]`, message: `Page "${page.id}" has no questions` });
  });

  for (const id of duplicates(definition.pages.map((p) => p.id))) issues.push({ path: "pages", message: `Page id "${id}" is used more than once` });
  for (const id of duplicates(questions.map((q) => q.id))) issues.push({ path: "pages", message: `Question id "${id}" is used more than once` });
  for (const id of duplicates(definition.metrics.map((m) => m.id))) issues.push({ path: "metrics", message: `Metric id "${id}" is used more than once` });
  for (const id of duplicates(definition.alerts.map((a) => a.id))) issues.push({ path: "alerts", message: `Alert id "${id}" is used more than once` });
  for (const id of duplicates(definition.suppressions.map((s) => s.id))) issues.push({ path: "suppressions", message: `Suppression id "${id}" is used more than once` });
  for (const p of duplicates(definition.alerts.map((a) => String(a.precedence)))) {
    issues.push({ path: "alerts", message: `Two alerts share precedence ${p}; give each a distinct order` });
  }

  // Display rules may only reference earlier questions, which also rules out cycles.
  const earlier = new Map<string, Question>();
  definition.pages.forEach((page, p) => {
    page.questions.forEach((question, q) => {
      const path = `pages[${p}].questions[${q}]`;
      const scope: ConditionScope = { questions: earlier, metrics: null, missingQuestionHint: "must come earlier in the survey" };

      if (question.type === "single_choice" || question.type === "multi_choice" || question.type === "matrix") {
        const options = question.type === "matrix" ? question.columns : question.choices;
        for (const id of duplicates(options.map((c) => c.id))) issues.push({ path, message: `Choice id "${id}" is used more than once in "${question.id}"` });
      }
      if (question.type === "matrix") {
        for (const id of duplicates(question.rows.map((r) => r.id))) issues.push({ path, message: `Row id "${id}" is used more than once in "${question.id}"` });
      }
      if (question.type === "rating" && question.min >= question.max) issues.push({ path, message: `Rating "${question.id}" needs min below max` });
      if (question.type === "rating" && question.max - question.min > 20) issues.push({ path, message: `Rating "${question.id}" allows at most 21 points` });
      if (question.type === "number" && question.min !== undefined && question.max !== undefined && question.min > question.max) {
        issues.push({ path, message: `Number "${question.id}" has min above max` });
      }
      if (question.type === "multi_choice") {
        const { minSelected, maxSelected, choices } = question;
        if (maxSelected !== undefined && maxSelected > choices.length) issues.push({ path, message: `"${question.id}" allows more selections than it has choices` });
        if (minSelected !== undefined && maxSelected !== undefined && minSelected > maxSelected) issues.push({ path, message: `"${question.id}" has minimum selections above maximum` });
      }

      if (question.visibleWhen) checkCondition(question.visibleWhen, scope, `${path}.visibleWhen`, issues);
      if (typeof question.required === "object") checkCondition(question.required, scope, `${path}.required`, issues);
      earlier.set(question.id, question);
    });
  });

  const all = new Map(questions.map((q) => [q.id, q]));
  definition.metrics.forEach((metric, m) => {
    const path = `metrics[${m}]`;
    if (metric.method === "share_matching" && !metric.matchValues) issues.push({ path, message: `Metric "${metric.id}" needs the values that count as a match` });
    if (metric.method !== "share_matching" && metric.matchValues) issues.push({ path, message: `Only share_matching metrics use match values` });
    if (metric.minAnswered > metric.items.length) issues.push({ path, message: `Metric "${metric.id}" requires more answers than it has items` });

    const seenItems = new Set<string>();
    metric.items.forEach((item, i) => {
      const itemPath = `${path}.items[${i}]`;
      const key = `${item.question}:${item.row ?? ""}`;
      if (seenItems.has(key)) issues.push({ path: itemPath, message: `"${key}" is scored twice in "${metric.id}"` });
      seenItems.add(key);

      const question = all.get(item.question);
      if (!question) {
        issues.push({ path: itemPath, message: `Unknown question "${item.question}"` });
        return;
      }
      if (question.type === "matrix" && !question.rows.some((r) => r.id === item.row)) {
        issues.push({ path: itemPath, message: `Choose a valid row of matrix "${question.id}"` });
      } else if (question.type !== "matrix" && item.row) {
        issues.push({ path: itemPath, message: `"${question.id}" is not a matrix question` });
      }
      if (metric.method === "share_matching") {
        if (question.type === "multi_choice" || question.type === "text") issues.push({ path: itemPath, message: `"${question.id}" cannot be matched against values` });
      } else if (!numericCapable(question)) {
        issues.push({ path: itemPath, message: `"${question.id}" has no numeric value; give its choices values` });
      } else if (metric.method === "ratio_of_max" && maxItemValue(question) === null) {
        issues.push({ path: itemPath, message: `"${question.id}" needs a maximum for ratio_of_max` });
      } else if (metric.method === "ratio_of_max" && (maxItemValue(question) ?? 0) <= 0) {
        issues.push({ path: itemPath, message: `"${question.id}" must have a positive maximum for ratio_of_max` });
      }
    });
  });

  const ruleScope: ConditionScope = { questions: all, metrics: new Set(definition.metrics.map((m) => m.id)), missingQuestionHint: "does not exist" };
  definition.alerts.forEach((alert, a) => checkCondition(alert.when, ruleScope, `alerts[${a}].when`, issues));
  definition.suppressions.forEach((rule, s) => checkCondition(rule.when, ruleScope, `suppressions[${s}].when`, issues));

  return issues;
}

/** Parse untrusted JSON into a definition, reporting shape errors as issues. */
export function parseDefinition(input: unknown): { ok: true; definition: InstrumentDefinition } | { ok: false; issues: DefinitionIssue[] } {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })) };
  }
  return { ok: true, definition: parsed.data };
}

/** A new, empty draft definition. */
export function emptyDefinition(): InstrumentDefinition {
  return { schemaVersion: DEFINITION_SCHEMA_VERSION, pages: [{ id: "page_1", questions: [] }], metrics: [], alerts: [], suppressions: [] };
}
