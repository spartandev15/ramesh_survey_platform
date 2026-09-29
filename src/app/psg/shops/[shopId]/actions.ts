"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAccessError } from "@/modules/access/errors";
import { openShopAddition } from "@/modules/instruments/instruments";
import { changeShopMode, setShopAdditionVersion, setShopLegacyCoverage, updateShopSettings } from "@/modules/shops/settings";
import { SHOP_MODES, settingsInputSchema, splitRecipients, type ShopMode } from "@/modules/shops/settings-policy";
import { ShopSettingsError } from "@/modules/shops/settings-store";

export type SettingsActionResult =
  | { ok: true; revision: number }
  | { ok: false; kind: "conflict" | "invalid" | "forbidden" | "not_found"; message: string; issues?: string[]; fieldErrors?: Record<string, string> };

function failure(error: unknown): SettingsActionResult {
  if (error instanceof ShopSettingsError) return { ok: false, kind: error.kind, message: error.message, issues: error.issues };
  if (isAccessError(error)) return { ok: false, kind: "forbidden", message: "You do not have permission to change shop settings." };
  throw error;
}

function refresh(shopId: string) {
  revalidatePath("/psg/shops");
  revalidatePath(`/psg/shops/${shopId}`);
}

export interface SettingsFormValues {
  instrumentVersionId: string;
  deliveryCutoff: string;
  timezone: string;
  reminderDelayDays: string;
  linkLifetimeDays: string;
  alertRecipients: string;
  logoUrl: string;
  brandColor: string;
}

export async function saveSettingsAction(shopId: string, expectedRevision: number, values: SettingsFormValues): Promise<SettingsActionResult> {
  const parsed = settingsInputSchema.safeParse({ ...values, alertRecipients: splitRecipients(values.alertRecipients) });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, kind: "invalid", message: "Check the highlighted fields.", fieldErrors };
  }
  try {
    const saved = await updateShopSettings(shopId, expectedRevision, parsed.data);
    refresh(shopId);
    return { ok: true, revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}

export async function setLegacyCoverageAction(shopId: string, expectedRevision: number, confirmed: boolean): Promise<SettingsActionResult> {
  try {
    const saved = await setShopLegacyCoverage(shopId, expectedRevision, confirmed);
    refresh(shopId);
    return { ok: true, revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}

/** Assign the shop's own published questions, or none (SR-45). Only new invitations pick them up. */
export async function setAdditionAction(shopId: string, expectedRevision: number, versionId: string | null): Promise<SettingsActionResult> {
  try {
    const saved = await setShopAdditionVersion(shopId, expectedRevision, versionId);
    refresh(shopId);
    return { ok: true, revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}

/** Open the shop's questions in the builder, creating them on first use. */
export async function openAdditionAction(shopId: string): Promise<{ ok: false; message: string } | never> {
  let instrumentId: string;
  try {
    instrumentId = (await openShopAddition(shopId)).id;
  } catch (error) {
    if (isAccessError(error)) return { ok: false, message: "Only a PSG admin can edit shop questions." };
    throw error;
  }
  redirect(`/psg/instruments/${instrumentId}`);
}

export async function changeModeAction(shopId: string, expectedRevision: number, target: ShopMode, confirmed: boolean): Promise<SettingsActionResult> {
  if (!SHOP_MODES.includes(target)) return { ok: false, kind: "invalid", message: "Choose Test, Live or Paused." };
  // Going Live is an outreach decision, so it needs an explicit confirmation (SR-04).
  if (target === "live" && !confirmed) return { ok: false, kind: "invalid", message: "Confirm the Live summary before switching." };
  try {
    const saved = await changeShopMode(shopId, expectedRevision, target);
    refresh(shopId);
    return { ok: true, revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}
