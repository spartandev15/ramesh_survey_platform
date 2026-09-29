"use server";

import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { qrDataUrl } from "@/lib/qr";
import { isAccessError } from "@/modules/access/errors";
import { recordOptOutForInvitation } from "@/modules/email-ledger/ledger";
import { LedgerError } from "@/modules/email-ledger/store";
import { correctInvitationContact, issuePrintableLink, sendSelectedInvitations } from "@/modules/invitations/invitations";
import { InvitationError, type SendResult } from "@/modules/invitations/store";

export type InvitationActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; reasons?: string[] };

function failure(error: unknown): InvitationActionResult<never> {
  if (error instanceof InvitationError) return { ok: false, message: error.message, reasons: error.reasons };
  if (isAccessError(error)) return { ok: false, message: "You do not have permission to send or change invitations." };
  throw error;
}

export async function sendInvitationsAction(shopId: string, items: { id: string; revision: number }[]): Promise<InvitationActionResult<{ results: SendResult[] }>> {
  try {
    const results = await sendSelectedInvitations(shopId, items);
    revalidatePath("/psg/invitations");
    return { ok: true, results };
  } catch (error) {
    return failure(error);
  }
}

export async function correctInvitationAction(shopId: string, id: string, revision: number, input: { email: string; deliveredOn: string }): Promise<InvitationActionResult> {
  try {
    await correctInvitationContact(shopId, id, revision, input);
    revalidatePath("/psg/invitations");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function printableLinkAction(shopId: string, id: string): Promise<InvitationActionResult<{ url: string; qr: string; expiresAt: string }>> {
  try {
    const link = await issuePrintableLink(shopId, id);
    const url = `${env().APP_URL.replace(/\/$/, "")}/survey/${link.token}`;
    // The QR encodes exactly the same link (AT-12).
    return { ok: true, url, qr: await qrDataUrl(url), expiresAt: link.expiresAt.toISOString() };
  } catch (error) {
    return failure(error);
  }
}

/** The customer asked PSG directly (phone or in person) to stop survey emails from this shop (SR-25). */
export async function recordOptOutAction(id: string): Promise<InvitationActionResult> {
  try {
    await recordOptOutForInvitation(id);
    revalidatePath("/psg/invitations");
    return { ok: true };
  } catch (error) {
    if (error instanceof LedgerError) return { ok: false, message: error.message };
    return failure(error);
  }
}
