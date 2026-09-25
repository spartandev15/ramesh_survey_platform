import "server-only";
import { getDb } from "@/db/client";
import { consumeRateLimit } from "@/lib/rate-limit";
import * as store from "./store";
import { hashToken, isWellFormedToken } from "./tokens";

/**
 * Public respondent operations. The token is the only credential: no staff
 * session is involved (SR-01, SR-12). Every entry point is rate limited per
 * client address and per token (PDF 04).
 */

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor() {
    super("Too many requests. Please wait a minute and try again.");
    this.name = "RateLimitedError";
  }
}

async function limit(kind: string, address: string, token: string, perAddress: number, perToken: number) {
  const tokenKey = isWellFormedToken(token) ? hashToken(token).slice(0, 32) : "malformed";
  const [byAddress, byToken] = await Promise.all([
    consumeRateLimit(`survey:${kind}:ip:${address}`, perAddress, 60),
    consumeRateLimit(`survey:${kind}:token:${tokenKey}`, perToken, 60),
  ]);
  if (!byAddress || !byToken) throw new RateLimitedError();
}

export async function openSurvey(token: string, address: string): Promise<store.TokenState> {
  await limit("open", address, token, 60, 30);
  if (!isWellFormedToken(token)) return { state: "invalid" };
  return getDb().transaction((tx) => store.getTokenState(tx, token));
}

export async function saveSurveyDraft(token: string, address: string, expectedRevision: number, answers: unknown): Promise<store.SaveResult> {
  // Autosave fires often while typing; the limits allow normal use and stop floods.
  await limit("save", address, token, 240, 120);
  if (!isWellFormedToken(token)) return { ok: false, reason: "invalid" };
  return getDb().transaction((tx) => store.saveDraft(tx, token, expectedRevision, answers));
}

export async function submitSurvey(token: string, address: string, requestKey: string, answers: unknown): Promise<store.SubmitResult> {
  await limit("submit", address, token, 30, 10);
  if (!isWellFormedToken(token) || !/^[A-Za-z0-9-]{8,64}$/.test(requestKey)) return { ok: false, reason: "invalid" };
  return getDb().transaction((tx) => store.submitResponse(tx, token, requestKey, answers));
}
