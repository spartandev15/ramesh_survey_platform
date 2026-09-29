import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { instrument, instrumentVersion, invitation, shop, shopReadiness, shopSurveySettings, suppressionAction, surveyResponse, user } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import { blockers, emailChecks, isManualItem, isReady, MANUAL_LABELS, shopChecks, type Check, type EmailFacts, type ManualItem, type ShopFacts } from "./policy";

/**
 * Launch readiness manifest (SR-37). Runs inside the caller's transaction and
 * does NOT authorize. A fixed number of queries covers every shop.
 */

export type Actor = { type: "user"; userId: string };

export class ReadinessError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "ReadinessError";
  }
}

export interface ShopReadiness {
  shopId: string;
  name: string;
  mode: ShopFacts["mode"];
  activatedAt: Date | null;
  checks: Check[];
  ready: boolean;
  missing: Check[];
}

export interface Manifest {
  email: Check[];
  shops: ShopReadiness[];
  /** Internal test shops never go Live, so they are listed apart and never counted (AT-37). */
  testShops: { shopId: string; name: string }[];
}

export async function manifest(tx: Tx, email: EmailFacts, onlyShopId?: string): Promise<Manifest> {
  const rows = await tx
    .select({
      shopId: shop.id,
      name: shop.name,
      isTestShop: shop.isTestShop,
      settings: shopSurveySettings,
      versionNumber: instrumentVersion.version,
      versionStatus: instrumentVersion.status,
      versionIsTest: instrumentVersion.isTest,
      instrumentName: instrument.name,
    })
    .from(shop)
    .innerJoin(shopSurveySettings, eq(shopSurveySettings.shopId, shop.id))
    .leftJoin(instrumentVersion, eq(instrumentVersion.id, shopSurveySettings.instrumentVersionId))
    .leftJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
    .where(and(isNull(shop.archivedAt), onlyShopId ? eq(shop.id, onlyShopId) : undefined))
    .orderBy(asc(shop.name));
  const inScope = rows.filter((r) => !r.isTestShop);
  const ids = inScope.map((r) => r.shopId);
  const emailResult = emailChecks(email);
  if (ids.length === 0) return { email: emailResult, shops: [], testShops: rows.filter((r) => r.isTestShop).map((r) => ({ shopId: r.shopId, name: r.name })) };

  // Production visits imported but never sent: going Live sends none of them (SR-04).
  const unsent = await tx
    .select({ shopId: invitation.shopId, n: sql<number>`count(*)::int` })
    .from(invitation)
    .where(
      and(
        inArray(invitation.shopId, ids),
        eq(invitation.isTest, false),
        isNotNull(invitation.visitId),
        inArray(invitation.status, ["eligible", "held"]),
        sql`NOT EXISTS (SELECT 1 FROM email_intent e WHERE e.invitation_id = ${invitation.id} AND e.kind = 'initial')`,
      ),
    )
    .groupBy(invitation.shopId);
  const suppression = await tx
    .select({ shopId: surveyResponse.shopId, n: sql<number>`count(*)::int` })
    .from(suppressionAction)
    .innerJoin(surveyResponse, eq(surveyResponse.id, suppressionAction.responseId))
    .where(and(inArray(surveyResponse.shopId, ids), eq(suppressionAction.status, "outstanding"), eq(suppressionAction.isTest, false)))
    .groupBy(surveyResponse.shopId);
  const confirmations = await tx
    .select({ shopId: shopReadiness.shopId, item: shopReadiness.item, at: shopReadiness.confirmedAt, note: shopReadiness.note, by: user.name })
    .from(shopReadiness)
    .innerJoin(user, eq(user.id, shopReadiness.confirmedBy))
    .where(inArray(shopReadiness.shopId, ids));

  const unsentBy = new Map(unsent.map((u) => [u.shopId, u.n]));
  const suppressionBy = new Map(suppression.map((s) => [s.shopId, s.n]));
  const confirmedBy = new Map<string, ShopFacts["confirmations"]>();
  for (const c of confirmations) {
    if (!isManualItem(c.item)) continue;
    const list = confirmedBy.get(c.shopId) ?? {};
    list[c.item] = { by: c.by, at: c.at, note: c.note };
    confirmedBy.set(c.shopId, list);
  }

  const shops = inScope.map((r) => {
    const checks = shopChecks({
      mode: r.settings.mode,
      activatedAt: r.settings.activatedAt,
      deliveryCutoff: r.settings.deliveryCutoff,
      version: r.versionStatus ? { label: `${r.instrumentName} v${r.versionNumber}${r.versionIsTest ? " (TEST)" : ""}`, status: r.versionStatus, isTest: Boolean(r.versionIsTest) } : null,
      alertRecipients: r.settings.alertRecipients.length,
      legacyCoverageConfirmedAt: r.settings.legacyCoverageConfirmedAt,
      unsentVisits: unsentBy.get(r.shopId) ?? 0,
      outstandingSuppression: suppressionBy.get(r.shopId) ?? 0,
      confirmations: confirmedBy.get(r.shopId) ?? {},
    });
    return { shopId: r.shopId, name: r.name, mode: r.settings.mode, activatedAt: r.settings.activatedAt, checks, ready: isReady(checks, emailResult), missing: blockers([...emailResult, ...checks]) };
  });
  return { email: emailResult, shops, testShops: rows.filter((r) => r.isTestShop).map((r) => ({ shopId: r.shopId, name: r.name })) };
}

async function inScopeShop(tx: Tx, shopId: string) {
  const [row] = await tx.select({ id: shop.id, isTestShop: shop.isTestShop, archivedAt: shop.archivedAt }).from(shop).where(eq(shop.id, shopId)).for("update");
  if (!row || row.archivedAt) throw new ReadinessError("not_found", "This shop no longer exists.");
  if (row.isTestShop) throw new ReadinessError("invalid", "An internal test shop never goes Live, so it has no launch checklist.");
}

/**
 * PSG records one launch check (who, when, what they checked). Acceptance is
 * refused while anything else fails, including the shared email setup.
 */
export async function confirmItem(tx: Tx, actor: Actor, shopId: string, item: string, note: string, email: EmailFacts, now = new Date()) {
  if (!isManualItem(item)) throw new ReadinessError("invalid", "Choose a check to confirm.");
  const trimmed = note.trim();
  if (trimmed.length < 5) throw new ReadinessError("invalid", "Write what you checked, so the record means something later.");
  await inScopeShop(tx, shopId);
  if (item === "acceptance") {
    const [current] = (await manifest(tx, email, shopId)).shops;
    const open = blockers([...current.checks, ...emailChecks(email)], { exceptAcceptance: true });
    if (open.length > 0) throw new ReadinessError("invalid", `Accept only when everything else passes. Still missing: ${open.map((c) => c.label).join(", ")}.`);
  }
  const [created] = await tx.insert(shopReadiness).values({ shopId, item, confirmedBy: actor.userId, confirmedAt: now, note: trimmed.slice(0, 1000) }).onConflictDoNothing().returning();
  if (!created) throw new ReadinessError("conflict", "This check is already confirmed. Reload the page.");
  await recordAudit({ actorType: "user", actorUserId: actor.userId, shopId, action: "shop.readiness_confirmed", subjectType: "shop", subjectId: shopId, after: { item, note: created.note } }, tx);
}

/**
 * Withdraw one check. Withdrawing any other check also withdraws the final
 * acceptance, because the sign-off no longer describes the shop.
 */
export async function withdrawItem(tx: Tx, actor: Actor, shopId: string, item: string, now = new Date()) {
  if (!isManualItem(item)) throw new ReadinessError("invalid", "Choose a check to withdraw.");
  await inScopeShop(tx, shopId);
  const items: ManualItem[] = item === "acceptance" ? ["acceptance"] : [item, "acceptance"];
  const removed = await tx.delete(shopReadiness).where(and(eq(shopReadiness.shopId, shopId), inArray(shopReadiness.item, items))).returning({ item: shopReadiness.item });
  if (!removed.some((r) => r.item === item)) throw new ReadinessError("conflict", "This check was already withdrawn. Reload the page.");
  for (const r of removed) {
    await recordAudit(
      { actorType: "user", actorUserId: actor.userId, shopId, action: "shop.readiness_withdrawn", subjectType: "shop", subjectId: shopId, after: { item: r.item, label: MANUAL_LABELS[r.item as ManualItem].label, at: now.toISOString() } },
      tx,
    );
  }
}
