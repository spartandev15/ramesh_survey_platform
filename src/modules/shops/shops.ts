import "server-only";
import { asc, count, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { shop } from "@/db/schema";
import { isPsgStaff } from "@/modules/access/capabilities";
import { requireCapability, requireShopRead, requireUser } from "@/modules/access/principal";
import { recordAudit } from "@/modules/audit/audit";
import type { ShopInput } from "./validation";

export type ShopRow = typeof shop.$inferSelect;

/** Every data function authorizes itself; callers cannot skip the check. */
export async function countActiveShops(): Promise<number> {
  await requireCapability("psg.workspace");
  const [row] = await getDb().select({ n: count() }).from(shop).where(isNull(shop.archivedAt));
  return row.n;
}

/** Shops visible to the current user: all for PSG staff, memberships only for shop users. */
export async function listVisibleShops(): Promise<ShopRow[]> {
  const { principal } = await requireUser();
  const db = getDb();
  if (isPsgStaff(principal)) {
    return db.select().from(shop).where(isNull(shop.archivedAt)).orderBy(asc(shop.name));
  }
  if (principal.shopIds.length === 0) return [];
  return db.select().from(shop).where(inArray(shop.id, [...principal.shopIds])).orderBy(asc(shop.name));
}

export async function getShop(shopId: string): Promise<ShopRow | null> {
  await requireShopRead(shopId);
  const [row] = await getDb().select().from(shop).where(eq(shop.id, shopId));
  return row ?? null;
}

export class DuplicateSlugError extends Error {
  constructor() {
    super("That public link name is already used by another shop");
    this.name = "DuplicateSlugError";
  }
}

export async function createShop(input: ShopInput): Promise<ShopRow> {
  const { principal } = await requireCapability("shop.manage");
  try {
    return await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(shop)
        .values({ name: input.name, publicSlug: input.publicSlug, timezone: input.timezone, isTestShop: input.isTestShop })
        .returning();
      await recordAudit(
        {
          actorType: "user",
          actorUserId: principal.userId,
          shopId: created.id,
          action: "shop.created",
          subjectType: "shop",
          subjectId: created.id,
          after: { name: created.name, publicSlug: created.publicSlug, timezone: created.timezone, isTestShop: created.isTestShop },
        },
        tx,
      );
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, "shop_public_slug_unique")) throw new DuplicateSlugError();
    throw error;
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = (error as { cause?: unknown })?.cause ?? error;
  return (e as { code?: string })?.code === "23505" && (e as { constraint?: string })?.constraint === constraint;
}
