import { describe, expect, it } from "vitest";
import { contrastRatio, textOn } from "./contrast";

describe("text on a brand colour (SR-02)", () => {
  it("picks the text colour with the higher contrast", () => {
    expect(textOn("#001c3d")).toBe("#ffffff");
    expect(textOn("#f5d000")).toBe("#000000");
    // A mid blue: white text would be about 3.7:1, below AA; dark text reads better.
    expect(textOn("#3a87d6")).toBe("#000000");
  });

  it("keeps normal text at AA (4.5:1) for any brand colour", () => {
    for (let i = 0; i < 4096; i++) {
      const hex = `#${[(i >> 8) & 15, (i >> 4) & 15, i & 15].map((n) => n.toString(16).repeat(2)).join("")}`;
      expect(contrastRatio(hex, textOn(hex))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
