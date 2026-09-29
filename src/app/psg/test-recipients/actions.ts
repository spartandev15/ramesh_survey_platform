"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { addTestAllowlistEntry, removeTestAllowlistEntry } from "@/modules/shops/settings";
import { ShopSettingsError } from "@/modules/shops/settings-store";

export type AllowlistActionResult = { ok: true } | { ok: false; message: string };

function failure(error: unknown): AllowlistActionResult {
  if (error instanceof ShopSettingsError) return { ok: false, message: error.message };
  if (isAccessError(error)) return { ok: false, message: "You do not have permission to change the test recipient list." };
  throw error;
}

export async function addEntryAction(entry: string, note: string): Promise<AllowlistActionResult> {
  try {
    await addTestAllowlistEntry(entry, note);
    revalidatePath("/psg/test-recipients");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function removeEntryAction(id: string): Promise<AllowlistActionResult> {
  try {
    await removeTestAllowlistEntry(id);
    revalidatePath("/psg/test-recipients");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
