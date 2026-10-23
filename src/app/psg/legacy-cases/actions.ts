"use server";

import { act } from "@/lib/action";
import { addLegacyCaseNote, handOffLegacyCase, resolveLegacyCase } from "@/modules/legacy-cases/legacy-cases";
import { LegacyCaseError } from "@/modules/legacy-cases/store";

// Refreshes the case page and list in the same response.
function run(caseId: string, body: () => Promise<unknown>) {
  return act(body, LegacyCaseError, ["/psg/legacy-cases", `/psg/legacy-cases/${caseId}`]);
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
