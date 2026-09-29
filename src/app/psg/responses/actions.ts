"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import type { AnswerError, Answers } from "@/modules/instruments/evaluate";
import * as staff from "@/modules/responses/staff";
import { StaffResponseError, type CandidateVisit } from "@/modules/responses/staff-store";

export type StaffActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; errors?: AnswerError[] };

function failure(error: unknown): StaffActionResult<never> {
  if (error instanceof StaffResponseError) return { ok: false, message: error.message, errors: error.errors };
  if (isAccessError(error)) return { ok: false, message: "You do not have permission to do this." };
  throw error;
}

function refresh(responseId?: string) {
  revalidatePath("/psg/responses");
  if (responseId) revalidatePath(`/psg/responses/${responseId}`);
}

export async function enterPaperAction(input: { shopId: string; visitId: string | null; receivedOn: string; answers: Answers; requestKey: string }): Promise<StaffActionResult<{ responseId: string }>> {
  try {
    const result = await staff.enterPaperResponse(input);
    refresh(result.responseId);
    revalidatePath("/psg/invitations");
    return { ok: true, responseId: result.responseId };
  } catch (error) {
    return failure(error);
  }
}

export async function searchVisitsAction(shopId: string, query: string) {
  const rows = await staff.searchShopVisits(shopId, query);
  return rows.map((r) => ({ id: r.id, label: `${r.sourceVisitKey} · ${[r.firstName, r.lastName].filter(Boolean).join(" ") || "Name not given"}${r.deliveredOn ? ` · delivered ${r.deliveredOn}` : ""}${r.isTest ? " · Test" : ""}` }));
}

export async function candidateVisitsAction(responseId: string, search: string): Promise<CandidateVisit[]> {
  return staff.findCandidateVisits(responseId, search);
}

export async function matchAction(responseId: string, matchRevision: number, visitId: string, evidence: string): Promise<StaffActionResult> {
  try {
    await staff.matchResponseToVisit(responseId, matchRevision, visitId, evidence);
    refresh(responseId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function unresolvedAction(responseId: string, matchRevision: number, note: string): Promise<StaffActionResult> {
  try {
    await staff.recordMatchUnresolved(responseId, matchRevision, note);
    refresh(responseId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function confirmShopAction(responseId: string, matchRevision: number, shopId: string, evidence: string): Promise<StaffActionResult> {
  try {
    await staff.confirmResponseShop(responseId, matchRevision, shopId, evidence);
    refresh(responseId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function duplicateAction(responseId: string, matchRevision: number, disposition: "keep_original" | "promote", note: string): Promise<StaffActionResult> {
  try {
    await staff.resolveDuplicateResponse(responseId, matchRevision, disposition, note);
    refresh(responseId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function correctAction(responseId: string, expectedRevision: number, answers: Answers, reason: string): Promise<StaffActionResult<{ alertsChanged: boolean }>> {
  try {
    const result = await staff.correctSubmittedResponse(responseId, expectedRevision, answers, reason);
    refresh(responseId);
    return { ok: true, alertsChanged: result.alertsChanged };
  } catch (error) {
    return failure(error);
  }
}
