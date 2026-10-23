"use server";

import { act } from "@/lib/action";
import { assignOperatorOwner, reviewOperatorItem } from "@/modules/operations/operations";
import { OperationsError } from "@/modules/operations/store";

function run(body: () => Promise<unknown>, denied: string) {
  return act(body, OperationsError, ["/psg/operations", "/psg"], denied);
}

export async function assignOwnerAction(subjectType: string, subjectId: string, ownerUserId: string | null, revision: number) {
  return run(() => assignOperatorOwner(subjectType, subjectId, ownerUserId, revision), "You do not have permission to assign operator items.");
}

export async function reviewItemAction(subjectType: string, subjectId: string, revision: number, note: string) {
  return run(() => reviewOperatorItem(subjectType, subjectId, revision, note), "You do not have permission to mark operator items reviewed.");
}
