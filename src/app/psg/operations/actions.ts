"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { assignOperatorOwner, reviewOperatorItem } from "@/modules/operations/operations";
import { OperationsError } from "@/modules/operations/store";

export type OperationsActionResult = { ok: true } | { ok: false; message: string };

async function run(body: () => Promise<unknown>, denied: string): Promise<OperationsActionResult> {
  try {
    await body();
    revalidatePath("/psg/operations");
    revalidatePath("/psg");
    return { ok: true };
  } catch (error) {
    if (error instanceof OperationsError) return { ok: false, message: error.message };
    if (isAccessError(error)) return { ok: false, message: denied };
    throw error;
  }
}

export async function assignOwnerAction(subjectType: string, subjectId: string, ownerUserId: string | null, revision: number) {
  return run(() => assignOperatorOwner(subjectType, subjectId, ownerUserId, revision), "You do not have permission to assign operator items.");
}

export async function reviewItemAction(subjectType: string, subjectId: string, revision: number, note: string) {
  return run(() => reviewOperatorItem(subjectType, subjectId, revision, note), "You do not have permission to mark operator items reviewed.");
}
