/**
 * Question helpers shared by the server and the survey in the browser. Kept
 * apart from definition.ts so the respondent's phone never downloads the
 * validation library that definition.ts is built on.
 */
import type { InstrumentDefinition, Question } from "./definition";

export function allQuestions(definition: InstrumentDefinition): Question[] {
  return definition.pages.flatMap((page) => page.questions);
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
