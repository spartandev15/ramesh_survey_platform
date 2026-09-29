import { describe, expect, it } from "vitest";
import { afterError, editedInFileMaker, MAX_ATTEMPTS, payloadHash, readiness, recordKey } from "./policy";

describe("bridge rules (SR-41..SR-43)", () => {
  it("hashes the same content the same way whatever the key order", () => {
    expect(payloadHash({ a: 1, b: { c: [1, 2], d: null } })).toBe(payloadHash({ b: { d: null, c: [1, 2] }, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });

  it("gives every Hub record one stable, marked key", () => {
    expect(recordKey("response", "r1")).toBe("hub:response:r1");
  });

  it("stays off, saying why, until a connection exists and every check is recorded", () => {
    const none = readiness(false, new Set());
    expect(none.enabled).toBe(false);
    if (!none.enabled) expect(none.reasons).toHaveLength(5);
    expect(readiness(true, new Set(["field_map", "alert_exclusion", "sandbox_test", "writes_enabled"]))).toEqual({ enabled: true });
    const almost = readiness(true, new Set(["field_map", "alert_exclusion", "sandbox_test"]));
    expect(almost).toMatchObject({ enabled: false, reasons: ["Not recorded yet: Writes switched on."] });
  });

  it("backs off between retries and then waits for a person", () => {
    const now = new Date("2026-09-28T10:00:00Z");
    expect(afterError(1, now)).toEqual({ state: "retrying", nextAttemptAt: new Date("2026-09-28T10:02:00Z") });
    expect(afterError(7, now)).toEqual({ state: "retrying", nextAttemptAt: new Date("2026-09-28T11:00:00Z") });
    expect(afterError(MAX_ATTEMPTS, now)).toEqual({ state: "failed" });
  });

  it("spots a record changed in FileMaker since Hub last confirmed it", () => {
    const confirmed = payloadHash({ a: 1 });
    expect(editedInFileMaker({ a: 1 }, confirmed)).toBe(false);
    expect(editedInFileMaker({ a: 2 }, confirmed)).toBe(true);
    // Nothing there yet, or never confirmed: nothing to protect.
    expect(editedInFileMaker(null, confirmed)).toBe(false);
    expect(editedInFileMaker({ a: 2 }, null)).toBe(false);
  });
});
