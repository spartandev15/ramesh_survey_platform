"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { confirmReadinessItem, withdrawReadinessItem } from "@/modules/readiness/readiness";
import { ReadinessError } from "@/modules/readiness/store";

export type ReadinessActionResult = { ok: true } | { ok: false; message: string };

async function run(shopId: string, body: () => Promise<unknown>): Promise<ReadinessActionResult> {
  try {
    await body();
    // Refreshes the page the check was made on in the same response (no router.refresh needed).
    revalidatePath("/psg/readiness");
    revalidatePath(`/psg/shops/${shopId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ReadinessError) return { ok: false, message: error.message };
    if (isAccessError(error)) return { ok: false, message: "Only a PSG admin can record launch checks." };
    throw error;
  }
}

export async function confirmItemAction(shopId: string, item: string, note: string) {
  return run(shopId, () => confirmReadinessItem(shopId, item, note));
}

export async function withdrawItemAction(shopId: string, item: string) {
  return run(shopId, () => withdrawReadinessItem(shopId, item));
}
