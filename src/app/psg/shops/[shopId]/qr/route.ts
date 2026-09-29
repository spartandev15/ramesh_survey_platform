import QRCode from "qrcode";
import { getShop } from "@/modules/shops/shops";
import { requireCapability } from "@/modules/access/principal";
import { isAccessError } from "@/modules/access/errors";
import { env } from "@/lib/env";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The QR code for a shop's public survey link, made on the server so the
 * link never goes to a third-party QR service (SR-13). PSG staff only.
 * `?download=png` or `?download=svg` saves it as a file.
 */
export async function GET(request: Request, { params }: RouteContext<"/psg/shops/[shopId]/qr">) {
  const { shopId } = await params;
  try {
    await requireCapability("psg.workspace");
  } catch (error) {
    if (isAccessError(error)) return new Response("Not found", { status: 404 });
    throw error;
  }
  const found = UUID_RE.test(shopId) ? await getShop(shopId) : null;
  if (!found || found.archivedAt) return new Response("Not found", { status: 404 });

  const url = `${env().APP_URL.replace(/\/$/, "")}/survey/shop/${found.publicSlug}`;
  const download = new URL(request.url).searchParams.get("download");
  const headers: Record<string, string> = { "Cache-Control": "private, max-age=300" };
  if (download === "png") {
    const png = await QRCode.toBuffer(url, { type: "png", margin: 2, width: 1024, errorCorrectionLevel: "M" });
    return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${found.publicSlug}-survey-qr.png"` } });
  }
  const svg = await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  if (download === "svg") headers["Content-Disposition"] = `attachment; filename="${found.publicSlug}-survey-qr.svg"`;
  return new Response(svg, { headers: { ...headers, "Content-Type": "image/svg+xml" } });
}
