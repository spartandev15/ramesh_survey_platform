import "server-only";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { shop, shopSurveySettings } from "@/db/schema";
import { isPsgStaff } from "@/modules/access/capabilities";
import { requireCapability, requireShopRead, requireUser } from "@/modules/access/principal";
import { recordAudit } from "@/modules/audit/audit";
import { insertDefaultSettings } from "./settings-store";
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
  return db
    .select()
    .from(shop)
    .where(and(inArray(shop.id, [...principal.shopIds]), isNull(shop.archivedAt)))
    .orderBy(asc(shop.name));
}

/**
 * Submitted responses per shop (real ones; an internal test shop shows its own test responses), and
 * the production total per month for the last 12 months (oldest first), for
 * the shop list. Test data never adds to the totals (SR-03). PSG staff only.
 */
export async function shopResponseStats(): Promise<{ byShop: Map<string, number>; production: number; monthly: number[] }> {
  await requireCapability("psg.workspace");
  return getDb().transaction(async (tx) => {
    // A production shop counts only real responses; an internal test shop counts its own test responses.
    const byShop = await tx.execute<{ shop_id: string; n: number }>(sql`SELECT r.shop_id, count(*) AS n FROM survey_response r JOIN shop s ON s.id = r.shop_id WHERE r.status = 'submitted' AND (NOT r.is_test OR s.is_test_shop) GROUP BY r.shop_id`);
    const [total] = (await tx.execute<{ n: number }>(sql`SELECT count(*) AS n FROM survey_response WHERE status = 'submitted' AND NOT is_test`)).rows;
    const monthly = await tx.execute<{ n: number }>(sql`
      SELECT count(r.id) AS n
      FROM generate_series(date_trunc('month', now() AT TIME ZONE 'America/New_York') - interval '11 months', date_trunc('month', now() AT TIME ZONE 'America/New_York'), interval '1 month') m
      LEFT JOIN survey_response r ON r.status = 'submitted' AND NOT r.is_test AND date_trunc('month', r.submitted_at AT TIME ZONE 'America/New_York') = m
      GROUP BY m ORDER BY m`);
    return { byShop: new Map(byShop.rows.map((r) => [r.shop_id, Number(r.n)])), production: Number(total?.n ?? 0), monthly: monthly.rows.map((r) => Number(r.n)) };
  });
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
      await insertDefaultSettings(tx, created.id);
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

export class ShopDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopDeleteError";
  }
}

/**
 * Deletes a shop from every list and screen. The package keeps every record
 * (PDF 09: "Do not delete records"), so the shop is archived: its responses,
 * cases, emails and audit history stay and it can no longer be used. A Live
 * shop must be paused first, and nothing may still be waiting to send.
 */
export async function deleteShop(shopId: string): Promise<{ name: string }> {
  const { principal } = await requireCapability("shop.manage");
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ shop, mode: shopSurveySettings.mode })
      .from(shop)
      .leftJoin(shopSurveySettings, eq(shopSurveySettings.shopId, shop.id))
      .where(eq(shop.id, shopId))
      .for("update", { of: shop });
    if (!row || row.shop.archivedAt) throw new ShopDeleteError("This shop was already deleted.");
    if (row.mode === "live") throw new ShopDeleteError("This shop is Live. Pause it on its page first, then delete it.");
    const waiting = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM email_intent e
      LEFT JOIN invitation i ON i.id = e.invitation_id
      LEFT JOIN alert_approval ap ON ap.id = e.alert_approval_id
      LEFT JOIN alert_case c ON c.id = ap.case_id
      WHERE e.state IN ('queued', 'held', 'sending') AND (i.shop_id = ${shopId} OR c.shop_id = ${shopId})`);
    const n = Number(waiting.rows[0]?.n ?? 0);
    if (n > 0) throw new ShopDeleteError(`${n} email${n === 1 ? " is" : "s are"} still waiting to send for this shop. Settle them in Email review first.`);
    const now = new Date();
    await tx.update(shop).set({ archivedAt: now }).where(eq(shop.id, shopId));
    await recordAudit(
      {
        actorType: "user",
        actorUserId: principal.userId,
        shopId,
        action: "shop.deleted",
        subjectType: "shop",
        subjectId: shopId,
        before: { name: row.shop.name, mode: row.mode },
        after: { archivedAt: now.toISOString(), recordsKept: true },
      },
      tx,
    );
    return { name: row.shop.name };
  });
}
