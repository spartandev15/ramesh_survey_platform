"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { addShopUser, MemberError, removeShopUser } from "@/modules/shops/members";

export type MemberActionResult = { ok: true; created?: boolean } | { ok: false; message: string };

function failure(error: unknown): MemberActionResult {
  if (error instanceof MemberError) return { ok: false, message: error.message };
  if (isAccessError(error)) return { ok: false, message: "You do not have permission to manage shop users." };
  throw error;
}

export async function addMemberAction(shopId: string, email: string, name: string): Promise<MemberActionResult> {
  try {
    const result = await addShopUser(shopId, { email, name });
    revalidatePath(`/psg/shops/${shopId}`);
    return { ok: true, created: result.created };
  } catch (error) {
    return failure(error);
  }
}

export async function removeMemberAction(shopId: string, userId: string): Promise<MemberActionResult> {
  try {
    await removeShopUser(shopId, userId);
    revalidatePath(`/psg/shops/${shopId}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
