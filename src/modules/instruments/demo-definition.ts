import { DEFINITION_SCHEMA_VERSION, type InstrumentDefinition } from "./definition";

/**
 * DEMO ONLY. Placeholder questions, formulas and alert rules for development
 * and internal testing. This is NOT the PSG instrument: the verified current
 * questions, scoring and alerts must come from PSG (gate G-01, SR-14) and
 * "unverified formulas do not ship as guessed rules" (AT-14). Versions built
 * from this definition are always published as test versions.
 */
export const DEMO_INSTRUMENT = {
  key: "demo_survey",
  name: "Demo survey (TEST)",
  description: "Placeholder survey for development and internal testing. Not the PSG instrument.",
} as const;

export const demoDefinition: InstrumentDefinition = {
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  intro: "Demo survey for internal testing. Answers are test data only.",
  pages: [
    {
      id: "experience",
      title: "Your repair experience",
      questions: [
        {
          id: "overall_rating",
          type: "rating",
          title: "Overall, how satisfied are you with your repair experience?",
          min: 1,
          max: 5,
          minLabel: "Very dissatisfied",
          maxLabel: "Very satisfied",
          required: true,
        },
        {
          id: "ready_on_time",
          type: "single_choice",
          display: "radio",
          title: "Was your vehicle ready when promised?",
          choices: [
            { id: "yes", label: "Yes", value: 1 },
            { id: "no", label: "No", value: 0 },
          ],
          required: true,
        },
        {
          id: "delay_detail",
          type: "text",
          title: "What happened with the timing of your repair?",
          multiline: true,
          maxLength: 2000,
          visibleWhen: { question: "ready_on_time", op: "equals", value: "no" },
          required: false,
        },
        {
          id: "service_aspects",
          type: "matrix",
          title: "How would you rate each part of your experience?",
          rows: [
            { id: "communication", label: "Communication during the repair" },
            { id: "quality", label: "Quality of the repair" },
            { id: "cleanliness", label: "Cleanliness of the vehicle at pickup" },
          ],
          columns: [
            { id: "poor", label: "Poor", value: 1 },
            { id: "fair", label: "Fair", value: 2 },
            { id: "good", label: "Good", value: 3 },
            { id: "excellent", label: "Excellent", value: 4 },
            { id: "na", label: "Not applicable" },
          ],
          required: true,
        },
      ],
    },
    {
      id: "recommend",
      title: "Recommendation",
      questions: [
        {
          id: "recommend_score",
          type: "rating",
          title: "How likely are you to recommend this shop to a friend?",
          min: 0,
          max: 10,
          minLabel: "Not at all likely",
          maxLabel: "Extremely likely",
          required: true,
        },
        {
          id: "improve_areas",
          type: "multi_choice",
          title: "What could the shop improve?",
          choices: [
            { id: "updates", label: "Repair status updates" },
            { id: "timing", label: "Meeting the promised date" },
            { id: "quality", label: "Repair quality" },
            { id: "billing", label: "Explaining the bill" },
          ],
          visibleWhen: { question: "recommend_score", op: "lte", value: 8 },
          required: false,
        },
        {
          id: "comments",
          type: "text",
          title: "Anything else you would like to tell us?",
          multiline: true,
          maxLength: 2000,
          required: false,
        },
      ],
    },
  ],
  metrics: [
    {
      id: "service_index",
      label: "Service index (demo)",
      method: "ratio_of_max",
      items: [
        { question: "service_aspects", row: "communication", weight: 1 },
        { question: "service_aspects", row: "quality", weight: 1 },
        { question: "service_aspects", row: "cleanliness", weight: 1 },
      ],
      missing: "ignore",
      minAnswered: 2,
    },
    {
      id: "on_time",
      label: "Ready when promised (demo)",
      method: "share_matching",
      items: [{ question: "ready_on_time", weight: 1 }],
      matchValues: ["yes"],
      missing: "ignore",
      minAnswered: 1,
    },
  ],
  alerts: [
    {
      id: "low_overall",
      label: "Low overall satisfaction (demo)",
      when: { question: "overall_rating", op: "lte", value: 2 },
      precedence: 1,
    },
    {
      id: "low_service_index",
      label: "Low service index (demo)",
      when: { metric: "service_index", op: "lt", value: 0.5 },
      precedence: 2,
    },
    {
      id: "not_on_time",
      label: "Vehicle not ready when promised (demo)",
      when: { question: "ready_on_time", op: "equals", value: "no" },
      precedence: 3,
    },
  ],
  suppressions: [
    {
      id: "hold_routine_mail",
      label: "Hold routine mail after a low overall rating (demo)",
      when: { question: "overall_rating", op: "lte", value: 2 },
    },
  ],
};
