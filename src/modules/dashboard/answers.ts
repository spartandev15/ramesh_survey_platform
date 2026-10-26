import type { InstrumentDefinition, Question } from "@/modules/instruments/definition";
import { isBlank, type Answers } from "@/modules/instruments/evaluate";
import { allQuestions } from "@/modules/instruments/questions";

/** A rating with more points than this is summarised like a number: a bar or filter per point would be unreadable. */
const MAX_RATING_POINTS = 11;
const isScale = (q: Question): q is Extract<Question, { type: "rating" }> => q.type === "rating" && q.max - q.min + 1 <= MAX_RATING_POINTS;

/**
 * Question results and the answer filter on the dashboard. Pure logic, so the
 * screen, the list and the export filter responses identically and every rule
 * is unit-tested. Question ids are stable across versions (SR-15), so one
 * filter works for every version of a survey.
 */

export type AnswerOp = "eq" | "lte" | "gte" | "has";

export interface AnswerFilter {
  question: string;
  /** Matrix row id. */
  row?: string;
  op: AnswerOp;
  value: string;
}

const ID = "[a-z][a-z0-9_]{0,62}";
const FILTER_RE = new RegExp(`^(${ID})(?:\\.(${ID}))?:(eq|lte|gte|has):(-?[0-9]+(?:\\.[0-9]+)?|${ID})$`);

/** `question[.row]:op:value`, e.g. `repair_rating:lte:2` or `grid.speed:eq:good`. Anything else is ignored. */
export function parseAnswerFilter(value: unknown): AnswerFilter | null {
  if (typeof value !== "string") return null;
  const m = FILTER_RE.exec(value);
  if (!m) return null;
  const op = m[3] as AnswerOp;
  if ((op === "lte" || op === "gte") && !Number.isFinite(Number(m[4]))) return null;
  return { question: m[1], ...(m[2] ? { row: m[2] } : {}), op, value: m[4] };
}

export function answerFilterParam(f: AnswerFilter): string {
  return `${f.question}${f.row ? `.${f.row}` : ""}:${f.op}:${f.value}`;
}

/** Whether a response's answers pass the filter. An unanswered question never matches. */
export function matchesAnswer(answers: Answers | null | undefined, f: AnswerFilter): boolean {
  const raw = answers?.[f.question];
  const value = f.row ? (raw && typeof raw === "object" && !Array.isArray(raw) ? raw[f.row] : undefined) : raw;
  if (isBlank(value)) return false;
  switch (f.op) {
    case "has":
      return Array.isArray(value) && value.includes(f.value);
    case "eq":
      return !Array.isArray(value) && typeof value !== "object" && String(value) === f.value;
    case "lte":
      return typeof value === "number" && value <= Number(f.value);
    case "gte":
      return typeof value === "number" && value >= Number(f.value);
  }
}

const optionLabel = (options: { id: string; label: string }[], id: string) => options.find((o) => o.id === id)?.label ?? id;

function valueLabel(question: Question | undefined, f: AnswerFilter): string {
  if (f.op === "lte") return `${f.value} or lower`;
  if (f.op === "gte") return `${f.value} or higher`;
  switch (question?.type) {
    case "single_choice":
      return optionLabel(question.choices, f.value);
    case "multi_choice":
      return `includes ${optionLabel(question.choices, f.value)}`;
    case "matrix":
      return optionLabel(question.columns, f.value);
    default:
      return f.value;
  }
}

/** "How satisfied are you?: 2 or lower", for the page and the export. */
export function describeAnswerFilter(f: AnswerFilter, definitions: InstrumentDefinition[]): string {
  const question = definitions.flatMap(allQuestions).find((q) => q.id === f.question);
  const row = f.row && question?.type === "matrix" ? question.rows.find((r) => r.id === f.row)?.label : f.row;
  return `${question?.title ?? f.question}${row ? ` (${row})` : ""}: ${valueLabel(question, f)}`;
}

/** Every filter the Filters popup offers for a survey version, grouped by question. */
export function answerFilterOptions(definition: InstrumentDefinition): { label: string; options: { value: string; label: string }[] }[] {
  const groups: { label: string; options: { value: string; label: string }[] }[] = [];
  const opt = (f: AnswerFilter, label: string) => ({ value: answerFilterParam(f), label });
  for (const q of allQuestions(definition)) {
    switch (q.type) {
      case "rating": {
        if (!isScale(q)) break;
        const values = Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i);
        groups.push({
          label: q.title,
          options: [
            ...values.map((v) => opt({ question: q.id, op: "eq", value: String(v) }, String(v))),
            ...values.slice(1, -1).map((v) => opt({ question: q.id, op: "lte", value: String(v) }, `${v} or lower`)),
            ...values.slice(1, -1).map((v) => opt({ question: q.id, op: "gte", value: String(v) }, `${v} or higher`)),
          ],
        });
        break;
      }
      case "single_choice":
        groups.push({ label: q.title, options: q.choices.map((c) => opt({ question: q.id, op: "eq", value: c.id }, c.label)) });
        break;
      case "multi_choice":
        groups.push({ label: q.title, options: q.choices.map((c) => opt({ question: q.id, op: "has", value: c.id }, `Includes ${c.label}`)) });
        break;
      case "matrix":
        for (const r of q.rows) groups.push({ label: `${q.title}: ${r.label}`, options: q.columns.map((c) => opt({ question: q.id, row: r.id, op: "eq", value: c.id }, c.label)) });
        break;
    }
  }
  return groups;
}

export interface Bar {
  label: string;
  count: number;
  /** The answer filter that shows these responses. */
  filter: string;
}

interface Base {
  id: string;
  title: string;
  /** Responses that answered it. */
  answered: number;
}

export type QuestionResult =
  | (Base & { kind: "bars"; multi: boolean; average: number | null; bars: Bar[] })
  | (Base & { kind: "matrix"; columns: { id: string; label: string }[]; rows: { id: string; label: string; answered: number; cells: Bar[] }[] })
  | (Base & { kind: "number"; average: number | null; min: number | null; max: number | null })
  | (Base & { kind: "text"; latest: { responseId: string; text: string }[] });

/** Comments shown under a text question; the rest are in the list and the export. */
const LATEST_TEXT = 3;

/**
 * How the responses answered each question of one survey version: a count per
 * choice or rating value, per matrix cell, a range for numbers, and the newest
 * comments. `responses` come newest first. Unanswered questions are left out
 * of the percentages, never counted as zero (PDF 04).
 */
export function questionResults(definition: InstrumentDefinition, responses: { id: string; answers: Answers | null }[]): QuestionResult[] {
  return allQuestions(definition).map((q): QuestionResult => {
    const values = responses.map((r) => ({ id: r.id, value: r.answers?.[q.id] })).filter((r) => !isBlank(r.value));
    const base = { id: q.id, title: q.title, answered: values.length };
    // One pass per question: how often each value (or matrix row and column) was given.
    const tally = new Map<string, number>();
    const add = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
    for (const { value } of values) {
      if (Array.isArray(value)) new Set(value).forEach(add);
      else if (typeof value === "object") for (const [row, column] of Object.entries(value!)) add(`${row}\u0000${column}`);
      else add(String(value));
    }
    const bar = (f: AnswerFilter, label: string): Bar => ({ label, count: tally.get(f.row ? `${f.row}\u0000${f.value}` : f.value) ?? 0, filter: answerFilterParam(f) });
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let n = 0;
    for (const { value } of values) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      n++;
    }
    const average = n ? sum / n : null;
    switch (q.type) {
      case "rating":
        if (!isScale(q)) return { ...base, kind: "number", average, min: n ? min : null, max: n ? max : null };
        return {
          ...base,
          kind: "bars",
          multi: false,
          average,
          bars: Array.from({ length: q.max - q.min + 1 }, (_, i) => String(q.min + i)).map((v) => bar({ question: q.id, op: "eq", value: v }, v)),
        };
      case "single_choice":
        return { ...base, kind: "bars", multi: false, average: null, bars: q.choices.map((c) => bar({ question: q.id, op: "eq", value: c.id }, c.label)) };
      case "multi_choice":
        return { ...base, kind: "bars", multi: true, average: null, bars: q.choices.map((c) => bar({ question: q.id, op: "has", value: c.id }, c.label)) };
      case "matrix":
        return {
          ...base,
          kind: "matrix",
          columns: q.columns.map((c) => ({ id: c.id, label: c.label })),
          rows: q.rows.map((r) => {
            const cells = q.columns.map((c) => bar({ question: q.id, row: r.id, op: "eq", value: c.id }, c.label));
            return { id: r.id, label: r.label, answered: cells.reduce((s, c) => s + c.count, 0), cells };
          }),
        };
      case "number":
        return { ...base, kind: "number", average, min: n ? min : null, max: n ? max : null };
      case "text":
        return { ...base, kind: "text", latest: values.slice(0, LATEST_TEXT).map((v) => ({ responseId: v.id, text: String(v.value) })) };
    }
  });
}
