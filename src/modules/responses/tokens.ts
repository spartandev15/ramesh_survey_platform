import { createHash, randomBytes } from "node:crypto";

/**
 * Survey access tokens (SR-12, SR-40): 256 bits from a CSPRNG, URL-safe, and
 * stored only as a SHA-256 hash so a database leak does not expose working links.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check before any database lookup; malformed input is simply "not found". */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Default personalized-link validity (SR-21). Per-shop configuration arrives with shop settings. */
export const DEFAULT_LINK_LIFETIME_DAYS = 90;
