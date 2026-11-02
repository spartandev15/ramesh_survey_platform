import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { sniffImageType } = await import("./logo");

describe("uploaded logo type", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

  it("reads the type from the file's first bytes", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38))).toBe("image/gif");
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
  });

  it("refuses SVG, HTML and anything else, whatever the file claims to be", () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', "<html><script>alert(1)</script>", "not an image", ""]) {
      expect(sniffImageType(new TextEncoder().encode(text)), text).toBeNull();
    }
    // RIFF but not WebP (e.g. a WAV file).
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });
});
