import "server-only";
import QRCode from "qrcode";

/**
 * A QR code for a survey link as an SVG data URL, generated on the server so
 * the link never goes to a third-party QR service (SR-12, SR-13).
 */
export async function qrDataUrl(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
