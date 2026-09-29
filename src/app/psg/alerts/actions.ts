"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import * as cases from "@/modules/cases/cases";
import { CaseError, type ResolutionOutcome, type SuppressionResult } from "@/modules/cases/store";

export type CaseActionResult = { ok: true } | { ok: false; message: string };

function failure(error: unknown): CaseActionResult {
  if (error instanceof CaseError) return { ok: false, message: error.message };
  if (isAccessError(error)) return { ok: false, message: "You do not have permission to do this." };
  throw error;
}

async function run(fn: () => Promise<unknown>, paths: string[]): Promise<CaseActionResult> {
  try {
    await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function approveAction(caseId: string, revision: number, recipients: string[], note: string) {
  return run(() => cases.approveAndSend(caseId, revision, recipients, note), ["/psg/alerts", `/psg/alerts/${caseId}`]);
}

export async function dismissAction(caseId: string, revision: number, note: string) {
  return run(() => cases.dismissCase(caseId, revision, note), ["/psg/alerts", `/psg/alerts/${caseId}`]);
}

export async function psgNoteAction(caseId: string, body: string, visibility: "shop" | "internal") {
  return run(() => cases.addPsgNote(caseId, body, visibility), [`/psg/alerts/${caseId}`]);
}

export async function resolveAction(caseId: string, revision: number, outcome: ResolutionOutcome, note: string) {
  return run(() => cases.resolveCase(caseId, revision, outcome, note), ["/psg/alerts", `/psg/alerts/${caseId}`]);
}

export async function acknowledgeAction(actionId: string, revision: number, result: SuppressionResult, evidence: string) {
  return run(() => cases.acknowledgeSuppression(actionId, revision, result, evidence), ["/psg/suppression"]);
}
