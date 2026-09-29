import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { applyProviderEvents } from "@/modules/email-ledger/store";
import { parseSendGridEvents, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySendGridSignature } from "@/modules/email-ledger/sendgrid-events";

/**
 * SendGrid delivery events (SR-23). Only signed requests are accepted; each
 * event is applied once, so provider retries and replays are harmless.
 */
export async function POST(request: Request) {
  const publicKey = env().SENDGRID_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) return Response.json({ code: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });

  const body = await request.text();
  if (body.length > 1_000_000) return Response.json({ code: "TOO_LARGE" }, { status: 413 });
  if (!verifySendGridSignature(publicKey, body, request.headers.get(SIGNATURE_HEADER), request.headers.get(TIMESTAMP_HEADER))) {
    return Response.json({ code: "INVALID_SIGNATURE" }, { status: 401 });
  }

  let events;
  try {
    events = parseSendGridEvents(body);
  } catch {
    return Response.json({ code: "INVALID_BODY" }, { status: 400 });
  }
  const result = await getDb().transaction((tx) => applyProviderEvents(tx, "sendgrid", events));
  logger.info({ ...result, received: events.length }, "sendgrid events");
  return new Response(null, { status: 204 });
}
