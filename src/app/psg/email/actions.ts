"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { resolveEmailProblem } from "@/modules/email-ledger/ledger";
import { LedgerError, type Resolution } from "@/modules/email-ledger/store";

export type LedgerActionResult = { ok: true } | { ok: false; message: string };

export async function resolveEmailAction(intentId: string, resolution: Resolution, note: string): Promise<LedgerActionResult> {
  try {
    await resolveEmailProblem(intentId, resolution, note);
    revalidatePath("/psg/email");
    revalidatePath("/psg/invitations");
    return { ok: true };
  } catch (error) {
    if (error instanceof LedgerError) return { ok: false, message: error.message };
    if (isAccessError(error)) return { ok: false, message: "You do not have permission to change emails." };
    throw error;
  }
}
