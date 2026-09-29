import "server-only";
import { getDb } from "@/db/client";
import { consumeRateLimit } from "@/lib/rate-limit";
import { hashToken, isWellFormedToken } from "@/modules/responses/tokens";
import { optOutVerifySecrets } from "./dispatcher";
import { verifyOptOutToken } from "./opt-out-token";
import * as store from "./store";

/**
 * Public, unauthenticated email operations: renewal and opt-out. Rate limited
 * per address and per token, and they never reveal whether a customer or an
 * email address exists (PDF 03, SR-22, SR-25).
 */

export class PublicRateLimitedError extends Error {
  constructor() {
    super("Too many requests. Please wait a minute and try again.");
    this.name = "PublicRateLimitedError";
  }
}

async function limit(kind: string, address: string, tokenKey: string, perAddress: number, perToken: number) {
  const allowedAddress = await consumeRateLimit(`survey:${kind}:ip:${address}`, perAddress, 60);
  const allowedToken = await consumeRateLimit(`survey:${kind}:token:${tokenKey}`, perToken, 60 * 60);
  if (!allowedAddress || !allowedToken) throw new PublicRateLimitedError();
}

/** The invitation an opt-out link is for, under the current or the earlier signing key. */
const verifiedInvitation = (token: string) => optOutVerifySecrets().map((secret) => verifyOptOutToken(secret, token)).find(Boolean) ?? null;

/** Always resolves the same way; an email goes out only when the record allows it. */
export async function requestSurveyRenewal(token: string, address: string): Promise<void> {
  const key = isWellFormedToken(token) ? hashToken(token).slice(0, 32) : "malformed";
  await limit("renew", address, key, 10, 5);
  if (!isWellFormedToken(token)) return;
  await getDb().transaction((tx) => store.requestRenewal(tx, token, new Date()));
}

/** Shop branding for the opt-out page, or null for a forged or unknown link. Never the address. */
export async function loadOptOutPage(token: string) {
  const invitationId = verifiedInvitation(token);
  if (!invitationId) return null;
  const ctx = await getDb().transaction((tx) => store.optOutContext(tx, invitationId));
  return ctx ? { shopName: ctx.shopName, logoUrl: ctx.logoUrl, brandColor: ctx.brandColor } : null;
}

export async function confirmOptOut(token: string, address: string): Promise<boolean> {
  await limit("optout", address, token.slice(0, 40), 20, 10);
  const invitationId = verifiedInvitation(token);
  if (!invitationId) return false;
  await getDb().transaction((tx) => store.recordOptOut(tx, { type: "respondent" }, invitationId, "respondent_link", new Date()));
  return true;
}
