"use server";

import { act } from "@/lib/action";
import { addShopNote, requestShopClosure } from "@/modules/cases/cases";
import { CaseError } from "@/modules/cases/store";

function run(fn: () => Promise<unknown>, shopId: string, caseId: string) {
  return act(fn, CaseError, [`/shop/${shopId}/cases`, `/shop/${shopId}/cases/${caseId}`], "This case is not available.");
}

export async function shopNoteAction(shopId: string, caseId: string, body: string) {
  return run(() => addShopNote(shopId, caseId, body), shopId, caseId);
}

export async function closureAction(shopId: string, caseId: string, revision: number, note: string) {
  return run(() => requestShopClosure(shopId, caseId, revision, note), shopId, caseId);
}
