import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Opt-out links (SR-25). The link names the invitation, never the email
 * address, and carries an HMAC so it cannot be forged or pointed at another
 * invitation. It keeps working after the survey link expires.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mac(secret: string, invitationId: string): string {
  return createHmac("sha256", secret).update(`survey-opt-out:v1:${invitationId}`).digest("base64url").slice(0, 32);
}

export function createOptOutToken(secret: string, invitationId: string): string {
  return `${invitationId}.${mac(secret, invitationId)}`;
}

/** The invitation id when the token is genuine, otherwise null. */
export function verifyOptOutToken(secret: string, token: string): string | null {
  const [id, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !id || !signature || !UUID_RE.test(id)) return null;
  const expected = Buffer.from(mac(secret, id));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}
