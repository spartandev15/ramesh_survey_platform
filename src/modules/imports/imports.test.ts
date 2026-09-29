import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "./csv";
import { planVisitRow, sameVisit, sendBlockers, type ShopFacts, type VisitFacts } from "./eligibility";
import { guessMapping, mappingIssues, normalizeEmail, normalizeVisitRow, parseDate, type NormalizedVisit } from "./mapping";

describe("parseCsv", () => {
  it("reads quoted values, doubled quotes, embedded new lines and CRLF", () => {
    const table = parseCsv('﻿RO,Name,Note\r\n1001,"Smith, Jo","He said ""fine""\nthen left"\r\n1002,Lee,\r\n\r\n');
    expect(table.headers).toEqual(["RO", "Name", "Note"]);
    expect(table.rows).toEqual([
      ["1001", "Smith, Jo", 'He said "fine"\nthen left'],
      ["1002", "Lee", ""],
    ]);
  });

  it("pads short rows and rejects broken files", () => {
    expect(parseCsv("a,b\n1").rows).toEqual([["1", ""]]);
    expect(() => parseCsv("")).toThrow(CsvError);
    expect(() => parseCsv('a,b\n"open')).toThrow(/quoted/);
    expect(() => parseCsv("a,a\n1,2")).toThrow(/same header/);
    expect(() => parseCsv("a,b\n1,2,3")).toThrow(/more values/);
  });
});

describe("mapping", () => {
  const headers = ["RO #", "First Name", "Last_Name", "E-mail", "Delivered On", "Notes"];

  it("suggests columns by header name", () => {
    expect(guessMapping(headers, "visits")).toEqual({ sourceVisitKey: "RO #", firstName: "First Name", lastName: "Last_Name", email: "E-mail", deliveredOn: "Delivered On" });
  });

  it("requires the visit ID and known columns", () => {
    expect(mappingIssues({}, headers, "visits")).toHaveLength(1);
    expect(mappingIssues({ sourceVisitKey: "Missing" }, headers, "visits").join(" ")).toMatch(/not in the file/);
    expect(mappingIssues({ sourceVisitKey: "RO #", email: "RO #" }, headers, "visits").join(" ")).toMatch(/more than one/);
    expect(mappingIssues({ sourceVisitKey: "RO #", repairOrder: "RO #" }, headers, "visits")).toEqual([]);
  });

  it("parses ISO and US dates and never guesses others (SR-10)", () => {
    expect(parseDate("2026-10-01")).toEqual({ value: "2026-10-01", invalid: false });
    expect(parseDate("10/1/2026")).toEqual({ value: "2026-10-01", invalid: false });
    expect(parseDate(" ")).toEqual({ value: null, invalid: false });
    expect(parseDate("2/30/2026").invalid).toBe(true);
    expect(parseDate("10/1/26").invalid).toBe(true);
    expect(parseDate("Oct 1").invalid).toBe(true);
  });

  it("normalizes email by trim and case only", () => {
    expect(normalizeEmail("  Jo.Smith+car@Example.COM ")).toBe("jo.smith+car@example.com");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });

  it("keeps raw values next to the normalized ones", () => {
    const row = normalizeVisitRow({ "RO #": " 1001 ", "E-mail": "bad@", "Delivered On": "13/45/2026" }, guessMapping(headers, "visits"));
    expect(row).toMatchObject({ sourceVisitKey: "1001", email: null, emailRaw: "bad@", deliveredOn: null, deliveredOnRaw: "13/45/2026", deliveredOnInvalid: true });
  });
});

describe("eligibility", () => {
  const live: ShopFacts = { mode: "live", deliveryCutoff: "2026-10-01", legacyCoverageConfirmed: true };
  const visit: VisitFacts = { isTest: false, emailNormalized: "jo@example.com", deliveredOn: "2026-10-01", legacy: null, optedOut: false, recipientAllowlisted: false };

  it("sends an eligible production visit in a Live shop", () => {
    expect(sendBlockers(visit, live)).toEqual([]);
  });

  it("applies the inclusive cutoff (AT-05)", () => {
    expect(sendBlockers({ ...visit, deliveredOn: "2026-09-30" }, live)).toEqual(["BEFORE_CUTOFF"]);
  });

  it("holds missing dates and emails without sending (AT-09, AT-10)", () => {
    expect(sendBlockers({ ...visit, deliveredOn: null }, live)).toEqual(["DELIVERY_DATE_NEEDED"]);
    expect(sendBlockers({ ...visit, emailNormalized: null }, live)).toEqual(["EMAIL_NEEDED"]);
  });

  it("excludes legacy sent-only and completed visits (AT-08)", () => {
    expect(sendBlockers({ ...visit, legacy: { invited: true, completed: false } }, live)).toEqual(["LEGACY_INVITED"]);
    expect(sendBlockers({ ...visit, legacy: { invited: true, completed: true } }, live)).toEqual(["LEGACY_COMPLETED"]);
  });

  it("flags unknown legacy coverage instead of assuming eligible (AT-08)", () => {
    expect(sendBlockers(visit, { ...live, legacyCoverageConfirmed: false })).toEqual(["LEGACY_COVERAGE_UNKNOWN"]);
  });

  it("waits for PSG selection in Test or Paused shops (AT-04)", () => {
    expect(sendBlockers(visit, { ...live, mode: "test" })).toEqual(["PREACTIVATION_IMPORT"]);
    expect(sendBlockers(visit, { ...live, mode: "paused" })).toEqual(["SHOP_PAUSED"]);
  });

  it("blocks opted-out recipients at this shop (SR-25)", () => {
    expect(sendBlockers({ ...visit, optedOut: true }, live)).toEqual(["SHOP_OPT_OUT"]);
  });

  it("lets test records reach only allowlisted addresses, in any mode (AT-03)", () => {
    const test = { ...visit, isTest: true };
    expect(sendBlockers(test, { ...live, mode: "test", legacyCoverageConfirmed: false })).toEqual(["TEST_RECIPIENT_NOT_ALLOWED"]);
    expect(sendBlockers({ ...test, recipientAllowlisted: true }, { mode: "test", deliveryCutoff: null, legacyCoverageConfirmed: false })).toEqual([]);
  });

  it("keeps several reasons together", () => {
    expect(sendBlockers({ ...visit, emailNormalized: null, deliveredOn: null }, { ...live, mode: "test" })).toEqual(["DELIVERY_DATE_NEEDED", "EMAIL_NEEDED", "PREACTIVATION_IMPORT"]);
  });
});

describe("planVisitRow (SR-06, SR-07)", () => {
  const live: ShopFacts = { mode: "live", deliveryCutoff: "2026-10-01", legacyCoverageConfirmed: true };
  const facts = { isTest: false, legacy: null, optedOut: false, recipientAllowlisted: false };
  const row: NormalizedVisit = {
    sourceVisitKey: "1001",
    repairOrder: null,
    firstName: "Jo",
    lastName: "Smith",
    email: "jo@example.com",
    emailRaw: "jo@example.com",
    emailNormalized: "jo@example.com",
    phone: null,
    deliveredOn: "2026-10-02",
    deliveredOnRaw: "2026-10-02",
    deliveredOnInvalid: false,
  };
  const existing = { sourceVisitKey: "1001", emailNormalized: "jo@example.com", lastName: "Smith", deliveredOn: "2026-10-02" };

  it("creates and sends a new eligible visit with no prior customer record (AT-06)", () => {
    expect(planVisitRow(row, null, facts, live)).toEqual({ action: "created", status: "eligible", reasons: [], send: true });
  });

  it("reuses a reimported visit without sending again", () => {
    expect(planVisitRow(row, existing, facts, live)).toEqual({ action: "reused", reasons: ["DUPLICATE_VISIT"] });
  });

  it("holds a reused visit key with a different customer or date (AT-07)", () => {
    expect(planVisitRow({ ...row, lastName: "Jones" }, existing, facts, live).action).toBe("held");
    expect(planVisitRow({ ...row, deliveredOn: "2026-11-01" }, existing, facts, live).action).toBe("held");
    expect(sameVisit(existing, { ...row, emailNormalized: null })).toBe(true);
  });

  it("holds a row with no visit ID", () => {
    expect(planVisitRow({ ...row, sourceVisitKey: null }, null, facts, live)).toEqual({ action: "held", reasons: ["VISIT_IDENTITY_UNCERTAIN"], createVisit: false });
  });

  it("creates a held invitation for a missing email so a printable link can exist (SR-09)", () => {
    expect(planVisitRow({ ...row, emailNormalized: null, email: null }, null, facts, live)).toEqual({ action: "created", status: "held", reasons: ["EMAIL_NEEDED"], send: false });
  });

  it("creates an excluded invitation for legacy evidence", () => {
    expect(planVisitRow(row, null, { ...facts, legacy: { invited: true, completed: false } }, live)).toMatchObject({ status: "excluded", send: false });
  });
});
