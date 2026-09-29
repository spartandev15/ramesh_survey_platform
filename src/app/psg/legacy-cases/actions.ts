"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { addLegacyCaseNote, handOffLegacyCase, resolveLegacyCase } from "@/modules/legacy-cases/legacy-cases";
import { LegacyCaseError } from "@/modules/legacy-cases/store";

export type LegacyActionResult = { ok: true } | { ok: false; message: string };

async function run(caseId: string, body: () => Promise<unknown>): Promise<LegacyActionResult> {
  try {
    await body();
    // Refreshes the case page and list in the same response.
    revalidatePath("/psg/legacy-cases");
    revalidatePath(`/psg/legacy-cases/${caseId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof LegacyCaseError) return { ok: false, message: error.message };
    if (isAccessError(error)) return { ok: false, message: "You do not have permission to do this." };
    throw error;
  }
}

export async function handOffAction(caseId: string, revision: number, note: string) {
  return run(caseId, () => handOffLegacyCase(caseId, revision, note));
}

export async function noteAction(caseId: string, body: string) {
  return run(caseId, () => addLegacyCaseNote(caseId, body));
}

export async function resolveAction(caseId: string, revision: number, outcome: string, note: string) {
  return run(caseId, () => resolveLegacyCase(caseId, revision, outcome, note));
}
