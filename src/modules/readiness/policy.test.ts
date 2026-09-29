import { describe, expect, it } from "vitest";
import { blockers, emailChecks, isManualItem, isReady, MANUAL_ITEMS, shopChecks, type ShopFacts } from "./policy";

const confirmed = { by: "Ramesh", at: new Date("2026-09-28T10:00:00Z"), note: "Checked" };
const allManual = Object.fromEntries(MANUAL_ITEMS.map((i) => [i, confirmed]));

const ready: ShopFacts = {
  mode: "test",
  activatedAt: null,
  deliveryCutoff: "2026-10-01",
  version: { label: "PSG Survey v2", status: "published", isTest: false },
  alertRecipients: 2,
  legacyCoverageConfirmedAt: new Date("2026-09-27T00:00:00Z"),
  unsentVisits: 3,
  outstandingSuppression: 1,
  confirmations: allManual,
};
const liveEmail = emailChecks({ provider: "sendgrid", webhookKey: true, from: "surveys@psg.example" });
const keys = (f: ShopFacts) => blockers(shopChecks(f)).map((c) => c.key);

describe("shop readiness (SR-37)", () => {
  it("is ready when every required check passes; unsent visits and suppression are information only", () => {
    expect(keys(ready)).toEqual([]);
    expect(isReady(shopChecks(ready), liveEmail)).toBe(true);
  });

  it("blocks on a TEST or missing survey version (G-01)", () => {
    expect(keys({ ...ready, version: { label: "Demo v1", status: "published", isTest: true } })).toEqual(["version"]);
    expect(keys({ ...ready, version: null })).toEqual(["version"]);
  });

  it("blocks on missing cutoff, recipients or legacy coverage", () => {
    expect(keys({ ...ready, deliveryCutoff: null, alertRecipients: 0, legacyCoverageConfirmedAt: null })).toEqual(["cutoff", "recipients", "legacy"]);
  });

  it("needs every PSG confirmation, acceptance last", () => {
    expect(keys({ ...ready, confirmations: {} })).toEqual(["mapping", "branding", "history", "opt_outs", "internal_test", "acceptance"]);
    // Acceptance may be given once only acceptance itself is missing.
    const withoutAcceptance = Object.fromEntries(Object.entries(allManual).filter(([item]) => item !== "acceptance"));
    expect(blockers(shopChecks({ ...ready, confirmations: withoutAcceptance }), { exceptAcceptance: true })).toEqual([]);
  });

  it("no shop is ready while email only goes to the log or receipts are unsigned", () => {
    expect(isReady(shopChecks(ready), emailChecks({ provider: "log", webhookKey: true, from: "x@y.z" }))).toBe(false);
    expect(isReady(shopChecks(ready), emailChecks({ provider: "sendgrid", webhookKey: false, from: "x@y.z" }))).toBe(false);
  });

  it("accepts only known manual items", () => {
    expect(isManualItem("branding")).toBe(true);
    expect(isManualItem("version")).toBe(false);
  });
});
