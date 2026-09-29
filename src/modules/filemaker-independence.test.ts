/**
 * SR-35 / AT-35 guard. Until the R2 bridge exists, Hub alone holds new
 * answers, corrections and follow-up, and no screen may claim FileMaker is
 * synchronized. This fails if app code starts calling FileMaker, or if any
 * user-facing text claims a sync, so the change goes through review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path: path.slice(SRC.length + 1), text: readFileSync(path, "utf8") }));

const CONNECTS = /FILEMAKER_|fmrest|\/fmi\/data\/|filemaker[-_]?(client|api|bridge)/i;
const CLAIMS_SYNC = /\b(synced|synchroni[sz]ed|in sync)\b|(sent|written|pushed|saved) to FileMaker|FileMaker (is )?(up to date|updated)/i;

describe("Hub works without FileMaker (SR-35)", () => {
  it("has no code that connects to FileMaker before the R2 bridge", () => {
    expect(files.filter((f) => CONNECTS.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("never tells anyone that FileMaker is synchronized (AT-35)", () => {
    expect(files.filter((f) => CLAIMS_SYNC.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("catches real violations but not honest wording", () => {
    expect(CONNECTS.test("await fetch(`${process.env.FILEMAKER_URL}/fmi/data/v1`)")).toBe(true);
    expect(CLAIMS_SYNC.test("Response synced")).toBe(true);
    expect(CLAIMS_SYNC.test("Saved to FileMaker")).toBe(true);
    expect(CLAIMS_SYNC.test("FileMaker is up to date")).toBe(true);
    // The manual queue's own wording is an operator's statement, not a sync claim.
    expect(CLAIMS_SYNC.test("Applied in FileMaker")).toBe(false);
    expect(CLAIMS_SYNC.test("Not connected: this response is kept in Hub only.")).toBe(false);
  });

  it("scans the whole app, so an empty result means something", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.path.includes("suppression"))).toBe(true);
  });
});
