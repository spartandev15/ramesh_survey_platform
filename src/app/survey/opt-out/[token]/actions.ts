"use server";

import { headers } from "next/headers";
import { clientAddress } from "@/lib/rate-limit";
import { confirmOptOut, PublicRateLimitedError } from "@/modules/email-ledger/public";

export type OptOutResult = { ok: true } | { ok: false; reason: "invalid" | "rate_limited" };

/** Opting out changes state only on this explicit POST, never on opening the link (PDF 05). */
export async function confirmOptOutAction(token: string): Promise<OptOutResult> {
  try {
    return (await confirmOptOut(token, clientAddress(await headers()))) ? { ok: true } : { ok: false, reason: "invalid" };
  } catch (error) {
    if (error instanceof PublicRateLimitedError) return { ok: false, reason: "rate_limited" };
    throw error;
  }
}
