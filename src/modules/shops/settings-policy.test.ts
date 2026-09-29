import { describe, expect, it } from "vitest";
import {
  allowlistEntrySchema,
  dispatchBlock,
  isIsoDate,
  matchesTestAllowlist,
  meetsDeliveryCutoff,
  modeChangeIssues,
  settingsInputSchema,
  settingsIssues,
  splitRecipients,
  todayInTimezone,
  type ModeContext,
} from "./settings-policy";

describe("delivery cutoff (SR-05, AT-05)", () => {
  it("includes the cutoff date and excludes the day before", () => {
    expect(meetsDeliveryCutoff("2026-10-01", "2026-10-01")).toBe(true);
    expect(meetsDeliveryCutoff("2026-09-30", "2026-10-01")).toBe(false);
    expect(meetsDeliveryCutoff("2027-01-02", "2026-10-01")).toBe(true);
  });

  it("never qualifies an impossible or malformed date", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(meetsDeliveryCutoff("2026-13-01", "2026-10-01")).toBe(false);
    expect(meetsDeliveryCutoff("", "2026-10-01")).toBe(false);
  });

  it("uses the shop's local calendar for today", () => {
    // 03:00 UTC on Oct 2 is still Oct 1 in Chicago.
    const now = new Date("2026-10-02T03:00:00Z");
    expect(todayInTimezone("America/Chicago", now)).toBe("2026-10-01");
    expect(todayInTimezone("UTC", now)).toBe("2026-10-02");
  });
});

describe("mode changes (SR-03, SR-04, SR-26)", () => {
  const ready: ModeContext = {
    mode: "test",
    isTestShop: false,
    activatedAt: null,
    deliveryCutoff: "2026-10-01",
    version: { status: "published", isTest: false },
  };

  it("allows Test to Live once cutoff and a verified version are set", () => {
    expect(modeChangeIssues(ready, "live")).toEqual([]);
  });

  it("lists everything missing before Live", () => {
    const issues = modeChangeIssues({ ...ready, deliveryCutoff: null, version: null }, "live");
    expect(issues).toHaveLength(2);
  });

  it("keeps TEST versions and internal test shops out of Live (AT-14)", () => {
    expect(modeChangeIssues({ ...ready, version: { status: "published", isTest: true } }, "live").join(" ")).toMatch(/TEST version/);
    expect(modeChangeIssues({ ...ready, isTestShop: true }, "live").join(" ")).toMatch(/internal test shop/);
  });

  it("pauses only a Live shop and resumes to Live", () => {
    expect(modeChangeIssues(ready, "paused")).not.toEqual([]);
    const live = { ...ready, mode: "live" as const, activatedAt: new Date() };
    expect(modeChangeIssues(live, "paused")).toEqual([]);
    expect(modeChangeIssues({ ...live, mode: "paused" }, "live")).toEqual([]);
  });

  it("does not return an activated shop to Test", () => {
    expect(modeChangeIssues({ ...ready, mode: "paused", activatedAt: new Date() }, "test")).not.toEqual([]);
  });

  it("reports a no-op change", () => {
    expect(modeChangeIssues(ready, "test")).toHaveLength(1);
  });
});

describe("settings outside Test mode", () => {
  it("requires a cutoff and a verified version while Live or Paused", () => {
    expect(settingsIssues("live", { deliveryCutoff: null }, { status: "published", isTest: false })).toHaveLength(1);
    expect(settingsIssues("paused", { deliveryCutoff: "2026-10-01" }, null)).toHaveLength(1);
    expect(settingsIssues("live", { deliveryCutoff: "2026-10-01" }, { status: "published", isTest: true })).toHaveLength(1);
    expect(settingsIssues("live", { deliveryCutoff: "2026-10-01" }, { status: "published", isTest: false })).toEqual([]);
  });

  it("allows an empty setup and TEST versions in Test mode", () => {
    expect(settingsIssues("test", { deliveryCutoff: null }, null)).toEqual([]);
    expect(settingsIssues("test", { deliveryCutoff: null }, { status: "published", isTest: true })).toEqual([]);
  });

  it("never assigns a draft", () => {
    expect(settingsIssues("test", { deliveryCutoff: null }, { status: "draft", isTest: true })).toHaveLength(1);
  });
});

describe("dispatch guard (AT-03, AT-26)", () => {
  it("refuses external recipients in Test mode and for test records", () => {
    expect(dispatchBlock({ mode: "test", kind: "initial", isTestRecord: true, recipientAllowlisted: false })).toBe("TEST_RECIPIENT_NOT_ALLOWED");
    expect(dispatchBlock({ mode: "live", kind: "initial", isTestRecord: true, recipientAllowlisted: false })).toBe("TEST_RECIPIENT_NOT_ALLOWED");
    expect(dispatchBlock({ mode: "test", kind: "initial", isTestRecord: true, recipientAllowlisted: true })).toBeNull();
  });

  it("stops invitations and reminders while Paused but lets a requested renewal through", () => {
    expect(dispatchBlock({ mode: "paused", kind: "initial", isTestRecord: false, recipientAllowlisted: false })).toBe("SHOP_PAUSED");
    expect(dispatchBlock({ mode: "paused", kind: "reminder", isTestRecord: false, recipientAllowlisted: false })).toBe("SHOP_PAUSED");
    expect(dispatchBlock({ mode: "paused", kind: "renewal", isTestRecord: false, recipientAllowlisted: false })).toBeNull();
  });

  it("lets Live production records send", () => {
    expect(dispatchBlock({ mode: "live", kind: "reminder", isTestRecord: false, recipientAllowlisted: false })).toBeNull();
  });
});

describe("test recipient allowlist", () => {
  const entries = ["qa@example.com", "@phoenixsolutionsgroup.net"];

  it("matches exact addresses and exact domains, ignoring case", () => {
    expect(matchesTestAllowlist("QA@Example.com", entries)).toBe(true);
    expect(matchesTestAllowlist("anyone@phoenixsolutionsgroup.net", entries)).toBe(true);
  });

  it("rejects subdomains, look-alike suffixes and other addresses", () => {
    expect(matchesTestAllowlist("other@example.com", entries)).toBe(false);
    expect(matchesTestAllowlist("x@mail.phoenixsolutionsgroup.net", entries)).toBe(false);
    expect(matchesTestAllowlist("x@evilphoenixsolutionsgroup.net", entries)).toBe(false);
    expect(matchesTestAllowlist("not-an-email", entries)).toBe(false);
  });

  it("validates entries", () => {
    expect(allowlistEntrySchema.parse(" @PhoenixSolutionsGroup.net ")).toBe("@phoenixsolutionsgroup.net");
    expect(allowlistEntrySchema.safeParse("@nodot").success).toBe(false);
    expect(allowlistEntrySchema.safeParse("nobody").success).toBe(false);
  });
});

describe("settings input", () => {
  const valid = {
    instrumentVersionId: "",
    deliveryCutoff: "2026-10-01",
    timezone: "America/Chicago",
    reminderDelayDays: "7",
    linkLifetimeDays: "90",
    alertRecipients: splitRecipients("Owner@Shop.com, owner@shop.com\nmanager@shop.com"),
    logoUrl: "",
    brandColor: "#1A2B3C",
  };

  it("normalizes blanks, numbers and duplicate recipients", () => {
    const parsed = settingsInputSchema.parse(valid);
    expect(parsed.instrumentVersionId).toBeNull();
    expect(parsed.logoUrl).toBeNull();
    expect(parsed.reminderDelayDays).toBe(7);
    expect(parsed.alertRecipients).toEqual(["owner@shop.com", "manager@shop.com"]);
  });

  it("rejects insecure logos, bad colours, bad timezones and out-of-range timing", () => {
    for (const change of [
      { logoUrl: "http://shop.com/logo.png" },
      { brandColor: "red" },
      { timezone: "Mars/Olympus" },
      { reminderDelayDays: "0" },
      { linkLifetimeDays: "400" },
      { deliveryCutoff: "2026-02-30" },
      { alertRecipients: ["not-an-email"] },
    ]) {
      expect(settingsInputSchema.safeParse({ ...valid, ...change }).success, JSON.stringify(change)).toBe(false);
    }
  });
});
