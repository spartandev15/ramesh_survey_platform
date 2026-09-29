/**
 * The real SendGrid webhook endpoint (SR-23, SR-40; AT-23, AT-40): unsigned,
 * forged, tampered or stale requests change nothing, a correctly signed one
 * is applied, and a replay is applied only once.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

try {
  if (!process.env.DATABASE_URL) process.loadEnvFile(".env");
} catch {
  // No .env file: the suite is skipped below.
}

describe.skipIf(!process.env.DATABASE_URL)("SendGrid webhook endpoint", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  // Set before the app reads its configuration for the first time.
  process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const { POST } = await import("./route");
  const { getDb, getPool } = await import("@/db/client");
  const { emailEvent } = await import("@/db/schema");
  const { eq, like } = await import("drizzle-orm");

  const run = `webhook-test-${Date.now()}`;
  const body = JSON.stringify([{ event: "delivered", sg_event_id: `${run}-1`, sg_message_id: `${run}.filter`, timestamp: Math.floor(Date.now() / 1000) }]);
  const signed = (payload: string, ts = String(Math.floor(Date.now() / 1000))) => ({
    "X-Twilio-Email-Event-Webhook-Signature": sign("sha256", Buffer.from(ts + payload), privateKey).toString("base64"),
    "X-Twilio-Email-Event-Webhook-Timestamp": ts,
  });
  const post = (payload: string, headers: Record<string, string> = {}) => POST(new Request("https://survey.test/api/survey-mail/events", { method: "POST", body: payload, headers }));
  const stored = async () => (await getDb().select().from(emailEvent).where(eq(emailEvent.providerEventId, `${run}-1`))).length;

  beforeAll(async () => {
    expect(await stored()).toBe(0);
  });

  afterAll(async () => {
    await getDb().delete(emailEvent).where(like(emailEvent.providerEventId, `${run}%`));
    await getPool().end();
  });

  it("refuses unsigned, forged, tampered and stale requests without storing anything (AT-40)", async () => {
    expect((await post(body)).status).toBe(401);
    expect((await post(body, { "X-Twilio-Email-Event-Webhook-Signature": "Zm9yZ2Vk", "X-Twilio-Email-Event-Webhook-Timestamp": String(Math.floor(Date.now() / 1000)) })).status).toBe(401);
    expect((await post(body.replace("delivered", "bounce"), signed(body))).status).toBe(401);
    expect((await post(body, signed(body, String(Math.floor(Date.now() / 1000) - 3600)))).status).toBe(401);
    expect(await stored()).toBe(0);
  });

  it("applies a correctly signed request once, even when the provider sends it again (AT-23)", async () => {
    expect((await post(body, signed(body))).status).toBe(204);
    expect((await post(body, signed(body))).status).toBe(204);
    expect(await stored()).toBe(1);
  });
});
