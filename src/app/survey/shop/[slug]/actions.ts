"use server";

import { headers } from "next/headers";
import { clientAddress } from "@/lib/rate-limit";
import type { AnswerError, Answers } from "@/modules/instruments/evaluate";
import { PublicFormRateLimitedError, submitPublicForm } from "@/modules/responses/public-form";

export type PublicSubmitResult = { ok: true } | { ok: false; reason: "invalid" | "unavailable" | "changed" | "already_submitted" | "rate_limited"; errors?: AnswerError[] };

/** Returns only whether it was saved: never anything about customers or visits (AT-13). */
export async function submitPublicAction(input: { slug: string; versionId: string; additionVersionId: string | null; answers: Answers; context: Record<string, string>; requestKey: string }): Promise<PublicSubmitResult> {
  try {
    const result = await submitPublicForm(clientAddress(await headers()), input);
    if (result.ok) return { ok: true };
    return { ok: false, reason: result.reason, errors: "errors" in result ? result.errors : undefined };
  } catch (error) {
    if (error instanceof PublicFormRateLimitedError) return { ok: false, reason: "rate_limited" };
    throw error;
  }
}
