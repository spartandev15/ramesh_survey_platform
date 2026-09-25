"use server";

import { headers } from "next/headers";
import { clientAddress } from "@/lib/rate-limit";
import type { AnswerError, Answers } from "@/modules/instruments/evaluate";
import { RateLimitedError, saveSurveyDraft, submitSurvey } from "@/modules/responses/respondent";

/** Public respondent actions: the token is the only credential (SR-12). */

export type DraftSaveResult =
  | { ok: true; revision: number; savedAt: string }
  | { ok: false; reason: "invalid" | "expired" | "submitted" | "stale" | "rate_limited"; errors?: AnswerError[] };

export async function saveDraftAction(input: { token: string; expectedRevision: number; answers: Answers }): Promise<DraftSaveResult> {
  const address = clientAddress(await headers());
  try {
    const result = await saveSurveyDraft(input.token, address, input.expectedRevision, input.answers);
    if (!result.ok) return { ok: false, reason: result.reason, errors: result.errors };
    return { ok: true, revision: result.revision, savedAt: result.savedAt.toISOString() };
  } catch (error) {
    if (error instanceof RateLimitedError) return { ok: false, reason: "rate_limited" };
    throw error;
  }
}

export type SubmitActionResult =
  | { ok: true; submittedAt: string }
  | { ok: false; reason: "invalid" | "expired" | "already_submitted" | "rate_limited"; errors?: AnswerError[] };

/** Scores and alerts are computed on the server and never returned to the respondent. */
export async function submitAction(input: { token: string; requestKey: string; answers: Answers }): Promise<SubmitActionResult> {
  const address = clientAddress(await headers());
  try {
    const result = await submitSurvey(input.token, address, input.requestKey, input.answers);
    if (!result.ok) return { ok: false, reason: result.reason, errors: result.errors };
    return { ok: true, submittedAt: result.submittedAt.toISOString() };
  } catch (error) {
    if (error instanceof RateLimitedError) return { ok: false, reason: "rate_limited" };
    throw error;
  }
}
