import { afterEach, describe, expect, it, vi } from "vitest";
import { pruneDevData, pruneKeep, realDataReason, unsafeSettingsReason } from "./prune";

const answer = (live: boolean, real: boolean, mailed = false) => async () => ({ rows: [{ live, real, mailed }] });

describe("development prune", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the keep setting as a positive whole number, or none", () => {
    expect(pruneKeep("100")).toBe(100);
    expect(pruneKeep(undefined)).toBeNull();
    expect(pruneKeep("")).toBeNull();
    expect(pruneKeep("0")).toBeNull();
    expect(pruneKeep("-5")).toBeNull();
    expect(pruneKeep("2.5")).toBeNull();
  });

  it("never runs in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(pruneDevData(100)).rejects.toThrow(/development databases only/);
  });

  it("refuses real email sending as well as production", async () => {
    expect(unsafeSettingsReason({ nodeEnv: "development", emailProvider: "log" })).toBeNull();
    expect(unsafeSettingsReason({ nodeEnv: undefined, emailProvider: undefined })).toBeNull();
    expect(unsafeSettingsReason({ nodeEnv: "development", emailProvider: "sendgrid" })).toMatch(/EMAIL_PROVIDER/);
    expect(unsafeSettingsReason({ nodeEnv: "production", emailProvider: "log" })).toMatch(/production/);
    vi.stubEnv("EMAIL_PROVIDER", "sendgrid");
    await expect(pruneDevData(100)).rejects.toThrow(/EMAIL_PROVIDER/);
  });

  it("refuses a database that holds real work, whatever NODE_ENV says", async () => {
    expect(await realDataReason(answer(false, false))).toBeNull();
    expect(await realDataReason(answer(true, false))).toMatch(/Live or Paused/);
    expect(await realDataReason(answer(false, true))).toMatch(/real \(non-test\) survey responses/);
    expect(await realDataReason(answer(false, false, true))).toMatch(/real customers were emailed/);
  });
});
