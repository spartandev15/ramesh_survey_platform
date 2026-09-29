import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auditEvent, instrument, instrumentVersion, shop, shopSurveySettings, testRecipientAllowlist, user } from "@/db/schema";
import { recordAudit } from "@/modules/audit/audit";
import {
  allowlistEntrySchema,
  matchesTestAllowlist,
  modeChangeIssues,
  settingsIssues,
  type SettingsInput,
  type ShopMode,
  type VersionFacts,
} from "./settings-policy";

/**
 * Shop survey settings persistence. These functions run inside the caller's
 * transaction and do NOT authorize: call them through `settings.ts` or from
 * trusted scripts acting as the system.
 */

export type Actor = { type: "user"; userId: string } | { type: "system" };

export class ShopSettingsError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid" | "not_found",
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ShopSettingsError";
  }
}

function auditActor(actor: Actor) {
  return actor.type === "user" ? { actorType: "user" as const, actorUserId: actor.userId } : { actorType: "system" as const };
}

export interface AssignedVersion {
  id: string;
  instrumentId: string;
  instrumentName: string;
  version: number;
  status: "draft" | "published";
  isTest: boolean;
}

export interface ShopSettingsView {
  shop: typeof shop.$inferSelect;
  settings: typeof shopSurveySettings.$inferSelect;
  version: AssignedVersion | null;
}

async function findVersionFacts(tx: Tx, versionId: string): Promise<AssignedVersion | null> {
  const [row] = await tx
    .select({
      id: instrumentVersion.id,
      instrumentId: instrumentVersion.instrumentId,
      instrumentName: instrument.name,
      version: instrumentVersion.version,
      status: instrumentVersion.status,
      isTest: instrumentVersion.isTest,
    })
    .from(instrumentVersion)
    .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
    .where(eq(instrumentVersion.id, versionId));
  return row ?? null;
}

/** Create the settings row for a new shop. Every shop starts in Test mode (SR-03). */
export async function insertDefaultSettings(tx: Tx, shopId: string): Promise<void> {
  await tx.insert(shopSurveySettings).values({ shopId }).onConflictDoNothing();
}

export async function getSettings(tx: Tx, shopId: string, forUpdate = false): Promise<ShopSettingsView | null> {
  const query = tx.select().from(shop).innerJoin(shopSurveySettings, eq(shopSurveySettings.shopId, shop.id)).where(eq(shop.id, shopId));
  const [row] = forUpdate ? await query.for("update") : await query;
  if (!row) return null;
  const version = row.shop_survey_settings.instrumentVersionId ? await findVersionFacts(tx, row.shop_survey_settings.instrumentVersionId) : null;
  return { shop: row.shop, settings: row.shop_survey_settings, version };
}

async function lockForChange(tx: Tx, shopId: string, expectedRevision: number): Promise<ShopSettingsView> {
  const current = await getSettings(tx, shopId, true);
  if (!current || current.shop.archivedAt) throw new ShopSettingsError("not_found", "This shop no longer exists.");
  if (current.settings.revision !== expectedRevision) {
    throw new ShopSettingsError("conflict", "Someone else changed these settings. Reload the page to see the latest values.");
  }
  return current;
}

function snapshot(view: { settings: typeof shopSurveySettings.$inferSelect; shop: typeof shop.$inferSelect }) {
  return {
    mode: view.settings.mode,
    deliveryCutoff: view.settings.deliveryCutoff,
    instrumentVersionId: view.settings.instrumentVersionId,
    reminderDelayDays: view.settings.reminderDelayDays,
    linkLifetimeDays: view.settings.linkLifetimeDays,
    alertRecipients: view.settings.alertRecipients,
    timezone: view.shop.timezone,
    logoUrl: view.shop.logoUrl,
    brandColor: view.shop.brandColor,
  };
}

/** Only the fields that changed, so the history reads as "what was changed". */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

/**
 * Save cutoff, assigned version, timing, alert recipients and branding.
 * Assigning another version affects only invitations issued afterwards;
 * issued invitations stay pinned to their own version (SR-15, AT-44).
 * Moving the cutoff earlier sends nothing: records it newly admits wait for
 * PSG selection (AT-05).
 */
export async function updateSettings(tx: Tx, actor: Actor, shopId: string, expectedRevision: number, input: SettingsInput, now = new Date()) {
  const current = await lockForChange(tx, shopId, expectedRevision);
  let version: VersionFacts | null = null;
  if (input.instrumentVersionId) {
    const found = await findVersionFacts(tx, input.instrumentVersionId);
    if (!found) throw new ShopSettingsError("invalid", "That survey version no longer exists.");
    version = found;
  }
  const issues = settingsIssues(current.settings.mode, input, version);
  if (issues.length > 0) throw new ShopSettingsError("invalid", "These settings cannot be saved yet.", issues);

  const actorId = actor.type === "user" ? actor.userId : null;
  const [settings] = await tx
    .update(shopSurveySettings)
    .set({
      deliveryCutoff: input.deliveryCutoff,
      instrumentVersionId: input.instrumentVersionId,
      reminderDelayDays: input.reminderDelayDays,
      linkLifetimeDays: input.linkLifetimeDays,
      alertRecipients: input.alertRecipients,
      revision: current.settings.revision + 1,
      updatedAt: now,
      updatedBy: actorId,
    })
    .where(eq(shopSurveySettings.shopId, shopId))
    .returning();
  const [updatedShop] = await tx
    .update(shop)
    .set({ timezone: input.timezone, logoUrl: input.logoUrl, brandColor: input.brandColor, updatedAt: now })
    .where(eq(shop.id, shopId))
    .returning();

  const changes = diff(snapshot(current), snapshot({ settings, shop: updatedShop }));
  if (Object.keys(changes.after).length > 0) {
    await recordAudit(
      { ...auditActor(actor), shopId, action: "shop.settings_updated", subjectType: "shop", subjectId: shopId, before: changes.before, after: changes.after },
      tx,
    );
  }
  return settings;
}

/**
 * Change the shop's mode (SR-03, SR-04, SR-26). A mode change never sends
 * anything: the waiting queue and preactivation imports need explicit PSG
 * selection, and only imports after `liveSince` may auto-send.
 */
export async function changeMode(tx: Tx, actor: Actor, shopId: string, expectedRevision: number, target: ShopMode, now = new Date()) {
  const current = await lockForChange(tx, shopId, expectedRevision);
  const issues = modeChangeIssues(
    {
      mode: current.settings.mode,
      isTestShop: current.shop.isTestShop,
      activatedAt: current.settings.activatedAt,
      deliveryCutoff: current.settings.deliveryCutoff,
      version: current.version,
    },
    target,
  );
  if (issues.length > 0) throw new ShopSettingsError("invalid", `The shop cannot switch to ${target} mode yet.`, issues);

  const [settings] = await tx
    .update(shopSurveySettings)
    .set({
      mode: target,
      activatedAt: current.settings.activatedAt ?? (target === "live" ? now : null),
      liveSince: target === "live" ? now : null,
      revision: current.settings.revision + 1,
      updatedAt: now,
      updatedBy: actor.type === "user" ? actor.userId : null,
    })
    .where(eq(shopSurveySettings.shopId, shopId))
    .returning();
  await recordAudit(
    {
      ...auditActor(actor),
      shopId,
      action: "shop.mode_changed",
      subjectType: "shop",
      subjectId: shopId,
      before: { mode: current.settings.mode },
      after: { mode: target, instrumentVersionId: settings.instrumentVersionId, deliveryCutoff: settings.deliveryCutoff },
    },
    tx,
  );
  return settings;
}

/**
 * Record that this shop's legacy send/completion history is fully loaded, or
 * withdraw that. Until confirmed, production records are held with
 * LEGACY_COVERAGE_UNKNOWN rather than assumed eligible (AT-08).
 */
export async function setLegacyCoverage(tx: Tx, actor: Actor, shopId: string, expectedRevision: number, confirmed: boolean, now = new Date()) {
  const current = await lockForChange(tx, shopId, expectedRevision);
  const [settings] = await tx
    .update(shopSurveySettings)
    .set({
      legacyCoverageConfirmedAt: confirmed ? (current.settings.legacyCoverageConfirmedAt ?? now) : null,
      revision: current.settings.revision + 1,
      updatedAt: now,
      updatedBy: actor.type === "user" ? actor.userId : null,
    })
    .where(eq(shopSurveySettings.shopId, shopId))
    .returning();
  await recordAudit(
    {
      ...auditActor(actor),
      shopId,
      action: "shop.settings_updated",
      subjectType: "shop",
      subjectId: shopId,
      before: { legacyCoverage: current.settings.legacyCoverageConfirmedAt !== null },
      after: { legacyCoverage: confirmed },
    },
    tx,
  );
  return settings;
}

/** Published versions PSG may assign. TEST versions are listed but refused outside Test mode. */
export async function listAssignableVersions(tx: Tx): Promise<AssignedVersion[]> {
  return tx
    .select({
      id: instrumentVersion.id,
      instrumentId: instrumentVersion.instrumentId,
      instrumentName: instrument.name,
      version: instrumentVersion.version,
      status: instrumentVersion.status,
      isTest: instrumentVersion.isTest,
    })
    .from(instrumentVersion)
    .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
    // Shared core surveys only; a shop's own questions are assigned separately (SR-45).
    .where(and(eq(instrumentVersion.status, "published"), isNull(instrument.shopId)))
    .orderBy(asc(instrument.name), desc(instrumentVersion.version));
}

/**
 * Assign this shop's own published questions, or none (SR-45). Only new
 * invitations pick them up; issued ones keep what they were sent. Outside
 * Test mode they must be verified content, as for the core (AT-14).
 */
export async function setAdditionVersion(tx: Tx, actor: Actor, shopId: string, expectedRevision: number, versionId: string | null, now = new Date()) {
  const current = await lockForChange(tx, shopId, expectedRevision);
  if (versionId) {
    const [v] = await tx
      .select({ status: instrumentVersion.status, isTest: instrumentVersion.isTest, ownerShopId: instrument.shopId })
      .from(instrumentVersion)
      .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
      .where(eq(instrumentVersion.id, versionId));
    if (!v || v.ownerShopId !== shopId) throw new ShopSettingsError("invalid", "Choose this shop's own questions.");
    if (v.status !== "published") throw new ShopSettingsError("invalid", "Publish the shop questions before assigning them.");
    if (v.isTest && current.settings.mode !== "test") throw new ShopSettingsError("invalid", `A ${current.settings.mode === "live" ? "Live" : "Paused"} shop cannot use TEST shop questions. Publish them as verified first.`);
  }
  if (current.settings.additionVersionId === versionId) return current.settings;
  const [settings] = await tx
    .update(shopSurveySettings)
    .set({ additionVersionId: versionId, revision: current.settings.revision + 1, updatedAt: now, updatedBy: actor.type === "user" ? actor.userId : null })
    .where(eq(shopSurveySettings.shopId, shopId))
    .returning();
  await recordAudit(
    { ...auditActor(actor), shopId, action: "shop.settings_updated", subjectType: "shop", subjectId: shopId, before: { additionVersionId: current.settings.additionVersionId }, after: { additionVersionId: versionId } },
    tx,
  );
  return settings;
}

export interface SettingsHistoryRow {
  id: number;
  occurredAt: Date;
  action: string;
  actorName: string | null;
  before: unknown;
  after: unknown;
}

const HISTORY_ACTIONS = ["shop.created", "shop.settings_updated", "shop.mode_changed"];

/** Activation and settings history for the shop profile, newest first. */
export async function listSettingsHistory(tx: Tx, shopId: string, limit = 500): Promise<SettingsHistoryRow[]> {
  return tx
    .select({
      id: auditEvent.id,
      occurredAt: auditEvent.occurredAt,
      action: auditEvent.action,
      actorName: user.name,
      before: auditEvent.before,
      after: auditEvent.after,
    })
    .from(auditEvent)
    .leftJoin(user, eq(user.id, auditEvent.actorUserId))
    .where(and(eq(auditEvent.shopId, shopId), eq(auditEvent.subjectType, "shop"), inArray(auditEvent.action, HISTORY_ACTIONS)))
    .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
    .limit(limit);
}

/** Mode of every active shop, for the shop list. */
export async function listShopModes(tx: Tx): Promise<Map<string, ShopMode>> {
  const rows = await tx
    .select({ shopId: shopSurveySettings.shopId, mode: shopSurveySettings.mode })
    .from(shopSurveySettings)
    .innerJoin(shop, eq(shop.id, shopSurveySettings.shopId))
    .where(isNull(shop.archivedAt));
  return new Map(rows.map((r) => [r.shopId, r.mode]));
}

// Internal test recipient allowlist (SR-03).

export async function listAllowlist(tx: Tx) {
  return tx.select().from(testRecipientAllowlist).orderBy(asc(testRecipientAllowlist.entry));
}

export async function addAllowlistEntry(tx: Tx, actor: Actor, rawEntry: string, note: string | null) {
  const parsed = allowlistEntrySchema.safeParse(rawEntry);
  if (!parsed.success) throw new ShopSettingsError("invalid", parsed.error.issues[0]?.message ?? "Enter an email address or domain");
  const [created] = await tx
    .insert(testRecipientAllowlist)
    .values({ entry: parsed.data, note: note?.trim() || null, createdBy: actor.type === "user" ? actor.userId : null })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ShopSettingsError("conflict", "That entry is already on the list.");
  await recordAudit({ ...auditActor(actor), action: "test_allowlist.added", subjectType: "test_allowlist", subjectId: created.id, after: { entry: created.entry } }, tx);
  return created;
}

export async function removeAllowlistEntry(tx: Tx, actor: Actor, id: string) {
  const [removed] = await tx.delete(testRecipientAllowlist).where(eq(testRecipientAllowlist.id, id)).returning();
  if (!removed) throw new ShopSettingsError("not_found", "That entry was already removed.");
  await recordAudit({ ...auditActor(actor), action: "test_allowlist.removed", subjectType: "test_allowlist", subjectId: removed.id, before: { entry: removed.entry } }, tx);
}

/** Server-side recipient check for the email dispatcher (AT-03). */
export async function isAllowlistedTestRecipient(tx: Tx, email: string): Promise<boolean> {
  const entries = await tx.select({ entry: testRecipientAllowlist.entry }).from(testRecipientAllowlist);
  return matchesTestAllowlist(
    email,
    entries.map((e) => e.entry),
  );
}
