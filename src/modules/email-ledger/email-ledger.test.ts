import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOptOutToken, verifyOptOutToken } from "./opt-out-token";
import { afterRejection, decideDispatch, linkExpiry, reminderDueAt, reminderStartsHeld, stateAfterEvent, type DispatchFacts } from "./policy";
import { parseSendGridEvents, verifySendGridSignature } from "./sendgrid-events";
import { renderEmail } from "./templates";

const DAY = 24 * 60 * 60 * 1000;

describe("decideDispatch (SR-23..SR-26)", () => {
  const live: DispatchFacts = {
    kind: "initial",
    mode: "live",
    isTest: false,
    recipientAllowlisted: false,
    optedOut: false,
    submitted: false,
    blockers: [],
    initialAccepted: false,
    linkOpen: true,
  };

  it("sends an eligible Live invitation", () => {
    expect(decideDispatch(live)).toEqual({ action: "send" });
  });

  it("cancels after submission or opt-out, whatever the kind (AT-24, AT-25)", () => {
    for (const kind of ["initial", "reminder", "renewal"] as const) {
      expect(decideDispatch({ ...live, kind, submitted: true })).toEqual({ action: "cancel", reason: "SUBMITTED" });
      expect(decideDispatch({ ...live, kind, optedOut: true })).toEqual({ action: "cancel", reason: "SHOP_OPT_OUT" });
    }
  });

  it("holds invitations and reminders for a shop paused before dispatch, but lets a renewal through (AT-26)", () => {
    expect(decideDispatch({ ...live, mode: "paused" })).toEqual({ action: "hold", reason: "SHOP_PAUSED" });
    expect(decideDispatch({ ...live, mode: "paused", kind: "reminder", initialAccepted: true })).toEqual({ action: "hold", reason: "SHOP_PAUSED" });
    expect(decideDispatch({ ...live, mode: "paused", kind: "renewal" })).toEqual({ action: "send" });
  });

  it("refuses test email to a non-allowlisted address server-side (AT-03)", () => {
    expect(decideDispatch({ ...live, isTest: true, mode: "test" })).toEqual({ action: "cancel", reason: "TEST_RECIPIENT_NOT_ALLOWED" });
    expect(decideDispatch({ ...live, isTest: true, mode: "test", recipientAllowlisted: true })).toEqual({ action: "send" });
  });

  it("never emails a production record from a Test-mode shop", () => {
    expect(decideDispatch({ ...live, mode: "test" })).toEqual({ action: "hold", reason: "PREACTIVATION_IMPORT" });
  });

  it("rechecks import eligibility for the initial send", () => {
    expect(decideDispatch({ ...live, blockers: ["LEGACY_INVITED"] })).toEqual({ action: "cancel", reason: "LEGACY_INVITED" });
    expect(decideDispatch({ ...live, blockers: ["BEFORE_CUTOFF"] })).toEqual({ action: "hold", reason: "BEFORE_CUTOFF" });
  });

  it("sends a reminder only after an accepted invitation and while the link is open", () => {
    const reminder = { ...live, kind: "reminder" as const };
    expect(decideDispatch(reminder)).toEqual({ action: "cancel", reason: "INITIAL_NOT_ACCEPTED" });
    expect(decideDispatch({ ...reminder, initialAccepted: true, linkOpen: false })).toEqual({ action: "cancel", reason: "LINK_EXPIRED" });
    expect(decideDispatch({ ...reminder, initialAccepted: true })).toEqual({ action: "send" });
  });
});

describe("timing", () => {
  const accepted = new Date("2026-10-01T15:00:00Z");

  it("dates the reminder from the accepted invitation (default 7 days)", () => {
    expect(reminderDueAt(accepted, 7).toISOString()).toBe("2026-10-08T15:00:00.000Z");
  });

  it("holds a reminder that fell due before the current Live period (P-04)", () => {
    const due = reminderDueAt(accepted, 7);
    expect(reminderStartsHeld(due, new Date("2026-10-10T00:00:00Z"))).toBe(true);
    expect(reminderStartsHeld(due, new Date("2026-09-01T00:00:00Z"))).toBe(false);
  });

  it("keeps the invitation deadline on a reminder and starts a new one on renewal (SR-21, SR-22)", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const deadline = new Date("2026-12-30T00:00:00Z");
    expect(linkExpiry("reminder", now, 90, deadline)).toBe(deadline);
    expect(linkExpiry("renewal", now, 90, deadline).getTime()).toBe(now.getTime() + 90 * DAY);
  });

  it("retries a definite rejection with backoff, then fails", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(afterRejection(1, now)).toEqual({ state: "queued", dueAt: new Date(now.getTime() + 5 * 60 * 1000) });
    expect(afterRejection(3, now)).toEqual({ state: "failed" });
  });
});

describe("provider events", () => {
  it("moves forward only, whatever order events arrive in", () => {
    expect(stateAfterEvent("accepted", "delivered")).toBe("delivered");
    expect(stateAfterEvent("delivered", "processed")).toBeNull();
    expect(stateAfterEvent("acceptance_unknown", "processed")).toBe("accepted");
    expect(stateAfterEvent("accepted", "bounce")).toBe("bounced");
    expect(stateAfterEvent("queued", "delivered")).toBeNull();
    expect(stateAfterEvent("accepted", "open")).toBeNull();
  });

  it("verifies SendGrid signatures and rejects tampering or stale timestamps", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const keyB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const now = new Date("2026-10-01T12:00:00Z");
    const ts = String(Math.floor(now.getTime() / 1000));
    const body = '[{"event":"delivered","sg_event_id":"e1"}]';
    const signature = sign("sha256", Buffer.from(ts + body), privateKey).toString("base64");

    expect(verifySendGridSignature(keyB64, body, signature, ts, now)).toBe(true);
    expect(verifySendGridSignature(keyB64, body.replace("delivered", "bounce"), signature, ts, now)).toBe(false);
    expect(verifySendGridSignature(keyB64, body, signature, ts, new Date(now.getTime() + 60 * 60 * 1000))).toBe(false);
    expect(verifySendGridSignature(keyB64, body, null, ts, now)).toBe(false);
    expect(verifySendGridSignature("not-a-key", body, signature, ts, now)).toBe(false);
  });

  it("keeps only what the ledger needs from events, never the recipient", () => {
    const id = "0b6e4c1a-8f5e-4c3b-9a55-0e8a4f1e2d3c";
    const [event, ...rest] = parseSendGridEvents(
      JSON.stringify([{ event: "bounce", sg_event_id: "ev-1", sg_message_id: "msg1.filter", timestamp: 1790000000, email: "jo@example.com", correlation_id: id, reason: "550 no user" }, { event: "x" }]),
    );
    expect(rest).toEqual([]);
    expect(event).toMatchObject({ providerEventId: "ev-1", eventType: "bounce", intentId: id, providerMessageId: "msg1" });
    expect(JSON.stringify(event)).not.toContain("jo@example.com");
    expect(() => parseSendGridEvents("{}")).toThrow();
  });
});

describe("opt-out links (SR-25)", () => {
  const id = "0b6e4c1a-8f5e-4c3b-9a55-0e8a4f1e2d3c";

  it("round-trips and cannot be forged or moved to another invitation", () => {
    const token = createOptOutToken("secret", id);
    expect(verifyOptOutToken("secret", token)).toBe(id);
    expect(verifyOptOutToken("other-secret", token)).toBeNull();
    expect(verifyOptOutToken("secret", token.replace(id, "1b6e4c1a-8f5e-4c3b-9a55-0e8a4f1e2d3c"))).toBeNull();
    expect(verifyOptOutToken("secret", `${token}x`)).toBeNull();
    expect(verifyOptOutToken("secret", "garbage")).toBeNull();
    expect(token).not.toContain("@");
  });
});

describe("email content", () => {
  const base = {
    kind: "initial" as const,
    isTest: false,
    shopName: "Joe's <Body> Shop",
    brandColor: "#7a1f2b",
    firstName: "Jo",
    surveyUrl: "https://example.com/survey/abc",
    optOutUrl: "https://example.com/survey/opt-out/x.y",
    expiresAt: new Date("2026-12-30T03:00:00Z"),
    timezone: "America/Chicago",
  };

  it("brands the email, links the survey and the opt-out, and dates expiry in shop time", () => {
    const email = renderEmail(base);
    expect(email.subject).toBe("How did your repair at Joe's <Body> Shop go?");
    expect(email.text).toContain("https://example.com/survey/abc");
    expect(email.text).toContain("opt out: https://example.com/survey/opt-out/x.y");
    expect(email.text).toContain("December 29, 2026");
    expect(email.html).toContain("Joe&#39;s &lt;Body&gt; Shop");
    expect(email.html).not.toContain("<Body>");
    expect(email.html).toContain("#7a1f2b");
  });

  it("marks test emails and says the reminder is the only one", () => {
    expect(renderEmail({ ...base, isTest: true }).subject).toMatch(/^\[TEST\] /);
    expect(renderEmail({ ...base, kind: "reminder" }).text).toContain("only reminder");
    expect(renderEmail({ ...base, kind: "renewal" }).text).toContain("Earlier links for this survey no longer work");
    expect(renderEmail({ ...base, firstName: null }).text.startsWith("Hello,")).toBe(true);
  });
});
