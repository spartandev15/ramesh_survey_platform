"use server";

import { revalidatePath } from "next/cache";
import { isAccessError } from "@/modules/access/errors";
import { createShop, deleteShop, DuplicateSlugError, ShopDeleteError } from "@/modules/shops/shops";
import { shopInputSchema } from "@/modules/shops/validation";

export interface CreateShopState {
  ok: boolean;
  message?: string;
  /** The new shop, linked from the success message: with a paged list it may not be on this page. */
  created?: { id: string; name: string };
  fieldErrors?: Partial<Record<"name" | "publicSlug" | "timezone", string>>;
  values?: { name: string; publicSlug: string; timezone: string; isTestShop: boolean };
}

export async function createShopAction(_prev: CreateShopState, formData: FormData): Promise<CreateShopState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    publicSlug: String(formData.get("publicSlug") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    isTestShop: formData.get("isTestShop") === "on",
  };

  const parsed = shopInputSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: CreateShopState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<CreateShopState["fieldErrors"]>;
      fieldErrors[key] ??= issue.message;
    }
    // Return typed values so the form keeps what the user entered (SR-39).
    return { ok: false, fieldErrors, values };
  }

  let created;
  try {
    created = await createShop(parsed.data);
  } catch (error) {
    if (error instanceof DuplicateSlugError) return { ok: false, fieldErrors: { publicSlug: error.message }, values };
    if (isAccessError(error)) return { ok: false, message: "You do not have permission to create shops.", values };
    throw error;
  }

  revalidatePath("/psg/shops");
  revalidatePath("/psg");
  return { ok: true, message: `Shop "${parsed.data.name}" created.`, created: { id: created.id, name: created.name } };
}

export async function deleteShopAction(shopId: string): Promise<{ ok: boolean; message: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return { ok: false, message: "This shop no longer exists." };
  try {
    const { name } = await deleteShop(shopId);
    revalidatePath("/psg/shops");
    revalidatePath("/psg");
    return { ok: true, message: `"${name}" was deleted. Its records and history are kept.` };
  } catch (error) {
    if (error instanceof ShopDeleteError) return { ok: false, message: error.message };
    if (isAccessError(error)) return { ok: false, message: "You do not have permission to delete shops." };
    throw error;
  }
}
