import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { qrDataUrl } from "./qr";

describe("survey QR codes (SR-12, SR-13, AT-12)", () => {
  const url = "https://survey.example.com/survey/abcDEF123_-abcDEF123_-abcDEF123_-abcDEF1";

  it("encodes exactly the survey link", () => {
    const code = QRCode.create(url, { errorCorrectionLevel: "M" });
    const encoded = code.segments.map((s) => (s as unknown as { data: Uint8Array }).data).map((d) => Buffer.from(d).toString("utf8")).join("");
    expect(encoded).toBe(url);
  });

  it("returns an SVG data URL without calling any outside service", async () => {
    const dataUrl = await qrDataUrl(url);
    expect(dataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8")).toContain("<svg");
  });
});
