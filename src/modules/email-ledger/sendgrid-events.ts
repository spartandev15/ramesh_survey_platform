import { createPublicKey, verify } from "node:crypto";

/**
 * SendGrid signed Event Webhook (SR-23). The signature is ECDSA P-256 over
 * timestamp + raw body; the public key comes from the SendGrid console.
 * Unsigned, stale or tampered requests are refused (AT-40).
 */

export const SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
export const TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";
const MAX_SKEW_SECONDS = 10 * 60;

export function verifySendGridSignature(publicKeyBase64: string, rawBody: string, signatureBase64: string | null, timestamp: string | null, now = new Date()): boolean {
  if (!signatureBase64 || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(timestamp + rawBody, "utf8"), { key, dsaEncoding: "der" }, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

export interface ProviderEvent {
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  intentId: string | null;
  providerMessageId: string | null;
  detail: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse the event array, keeping only what the ledger needs (never the recipient address). */
export function parseSendGridEvents(rawBody: string): ProviderEvent[] {
  const parsed: unknown = JSON.parse(rawBody);
  if (!Array.isArray(parsed)) throw new Error("Expected an array of events");
  return parsed.flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const ev = e as Record<string, unknown>;
    const id = typeof ev.sg_event_id === "string" ? ev.sg_event_id : null;
    const type = typeof ev.event === "string" ? ev.event : null;
    if (!id || !type) return [];
    const correlation = typeof ev.correlation_id === "string" && UUID_RE.test(ev.correlation_id) ? ev.correlation_id : null;
    const messageId = typeof ev.sg_message_id === "string" ? ev.sg_message_id.split(".")[0] : null;
    return [
      {
        providerEventId: id.slice(0, 200),
        eventType: type.slice(0, 40),
        occurredAt: typeof ev.timestamp === "number" ? new Date(ev.timestamp * 1000) : new Date(),
        intentId: correlation,
        providerMessageId: messageId,
        detail: { reason: typeof ev.reason === "string" ? ev.reason.slice(0, 300) : undefined, type: typeof ev.type === "string" ? ev.type : undefined },
      },
    ];
  });
}
