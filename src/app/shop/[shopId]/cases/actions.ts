"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { addShopNote, requestShopClosure } from "@/modules/cases/cases";
import { CaseError } from "@/modules/cases/store";

export type ShopCaseResult = { ok: true } | { ok: false; message: string };

async function run(fn: () => Promise<unknown>, shopId: string, caseId: string): Promise<ShopCaseResult> {
  try {
    await fn();
    revalidatePath(`/shop/${shopId}/cases`);
    revalidatePath(`/shop/${shopId}/cases/${caseId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof CaseError) return { ok: false, message: error.message };
    if (isAccessError(error)) return { ok: false, message: "This case is not available." };
    throw error;
  }
}

export async function shopNoteAction(shopId: string, caseId: string, body: string) {
  return run(() => addShopNote(shopId, caseId, body), shopId, caseId);
}

export async function closureAction(shopId: string, caseId: string, revision: number, note: string) {
  return run(() => requestShopClosure(shopId, caseId, revision, note), shopId, caseId);
}
