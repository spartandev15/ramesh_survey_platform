import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { shop, shopLogo } from "@/db/schema";
import { requireCapability } from "@/modules/access/principal";
import { ShopSettingsError } from "./settings-store";

/**
 * Shop logos uploaded to the app (SR-02), kept in the database so they live with the rest of the
 * shop's data on any host. The upload only stores the image; it shows on surveys once PSG saves
 * the settings with its address, so the change is recorded in the settings history like any other.
 */

export const MAX_LOGO_BYTES = 500 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The image type from the file's first bytes; the browser's claim is not trusted. SVG is refused (it can carry script). */
export function sniffImageType(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** Store a shop's logo and return the address to save in its settings. */
export async function uploadShopLogo(shopId: string, file: File): Promise<string> {
  await requireCapability("shop.manage");
  if (!UUID_RE.test(shopId)) throw new ShopSettingsError("not_found", "This shop no longer exists.");
  if (file.size === 0) throw new ShopSettingsError("invalid", "Choose an image file.");
  if (file.size > MAX_LOGO_BYTES) throw new ShopSettingsError("invalid", "The logo must be 500 KB or smaller.");
  const data = Buffer.from(await file.arrayBuffer());
  const contentType = sniffImageType(data);
  if (!contentType) throw new ShopSettingsError("invalid", "Use a PNG, JPG, WebP or GIF image.");
  const now = new Date();
  await getDb().transaction(async (tx) => {
    const [live] = await tx.select({ id: shop.id }).from(shop).where(and(eq(shop.id, shopId), isNull(shop.archivedAt)));
    if (!live) throw new ShopSettingsError("not_found", "This shop no longer exists.");
    await tx
      .insert(shopLogo)
      .values({ shopId, contentType, data, updatedAt: now })
      .onConflictDoUpdate({ target: shopLogo.shopId, set: { contentType, data, updatedAt: now } });
  });
  return `/shop-logo/${shopId}?v=${now.getTime()}`;
}

/** The stored logo for the public route; null when there is none. */
export async function readShopLogo(shopId: string) {
  if (!UUID_RE.test(shopId)) return null;
  const [row] = await getDb().select({ contentType: shopLogo.contentType, data: shopLogo.data }).from(shopLogo).where(eq(shopLogo.shopId, shopId));
  return row ?? null;
}
