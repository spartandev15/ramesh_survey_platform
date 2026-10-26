import "server-only";
import { eq } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";
import { shopSurveySettings } from "@/db/schema";
import { requireCapability } from "@/modules/access/principal";
import { listShopAdditionVersions } from "@/modules/instruments/store";
import { listUnsent, type QueueRow } from "@/modules/invitations/store";
import { launchBlockers } from "@/modules/readiness/readiness";
import type { SettingsInput, ShopMode } from "./settings-policy";
import * as store from "./settings-store";

/**
 * Authorized entry points for shop survey settings. PSG controls setup,
 * branding and mode (SR-01); shop users never see or change these.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(id: string) {
  if (!UUID_RE.test(id)) throw new store.ShopSettingsError("not_found", "This shop no longer exists.");
}

/**
 * What is waiting to send before Live (PDF 03 §1): eligible, held and excluded
 * production invitations with no invitation email yet, and how many people they reach.
 */
export interface WaitingSummary {
  eligible: number;
  held: number;
  excluded: number;
  recipients: number;
}

function summarizeWaiting(rows: QueueRow[]): WaitingSummary {
  const eligible = rows.filter((r) => r.view === "ready" || r.view === "waiting");
  return {
    eligible: eligible.length,
    held: rows.filter((r) => r.view === "held").length,
    excluded: rows.filter((r) => r.view === "excluded").length,
    recipients: new Set(eligible.map((r) => r.email?.trim().toLowerCase()).filter(Boolean)).size,
  };
}

export async function getShopSettingsPage(shopId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(shopId)) return null;
  return getDb().transaction(async (tx) => {
    const view = await store.getSettings(tx, shopId);
    if (!view || view.shop.archivedAt) return null;
    const versions = await store.listAssignableVersions(tx);
    const history = await store.listSettingsHistory(tx, shopId);
    const additions = await listShopAdditionVersions(tx, shopId);
    const waiting = summarizeWaiting(await listUnsent(tx, shopId, false));
    return { ...view, versions, history, additions, waiting };
  });
}

/** The survey version new invitations use, for page headers; null when none is assigned. */
export async function shopSurveyVersion(shopId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(shopId)) return null;
  return getDb().transaction(async (tx) => (await store.getSettings(tx, shopId))?.version ?? null);
}

/** Assign the shop's own published questions, or none (SR-45). PSG admins only. */
export async function setShopAdditionVersion(shopId: string, expectedRevision: number, versionId: string | null) {
  const { principal } = await requireCapability("shop.manage");
  requireId(shopId);
  if (versionId) requireId(versionId);
  return getDb().transaction((tx) => store.setAdditionVersion(tx, { type: "user", userId: principal.userId }, shopId, expectedRevision, versionId));
}

export async function listShopModes() {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => store.listShopModes(tx));
}

export async function updateShopSettings(shopId: string, expectedRevision: number, input: SettingsInput) {
  const { principal } = await requireCapability("shop.manage");
  requireId(shopId);
  return getDb().transaction((tx) => store.updateSettings(tx, { type: "user", userId: principal.userId }, shopId, expectedRevision, input));
}

export async function changeShopMode(shopId: string, expectedRevision: number, target: ShopMode) {
  const { principal } = await requireCapability("shop.manage");
  requireId(shopId);
  return getDb().transaction(async (tx) => {
    await requireLaunchReady(tx, shopId, target);
    return store.changeMode(tx, { type: "user", userId: principal.userId }, shopId, expectedRevision, target);
  });
}

/**
 * The first switch to Live needs the whole launch checklist, acceptance last (SR-37). Resuming a paused
 * shop does not. The settings row is locked first, so a check recorded or withdrawn at the same moment
 * cannot slip between this check and the switch.
 */
export async function requireLaunchReady(tx: Tx, shopId: string, target: ShopMode) {
  if (target !== "live") return;
  const [locked] = await tx.select({ activatedAt: shopSurveySettings.activatedAt }).from(shopSurveySettings).where(eq(shopSurveySettings.shopId, shopId)).for("update");
  if (!locked || locked.activatedAt) return;
  const blockers = await launchBlockers(tx, shopId);
  if (blockers.length > 0) throw new store.ShopSettingsError("invalid", "The shop cannot switch to Live until its launch checklist is complete.", blockers);
}

export async function setShopLegacyCoverage(shopId: string, expectedRevision: number, confirmed: boolean) {
  const { principal } = await requireCapability("shop.manage");
  requireId(shopId);
  return getDb().transaction((tx) => store.setLegacyCoverage(tx, { type: "user", userId: principal.userId }, shopId, expectedRevision, confirmed));
}

export async function listTestAllowlist() {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => store.listAllowlist(tx));
}

export async function addTestAllowlistEntry(entry: string, note: string | null) {
  const { principal } = await requireCapability("shop.manage");
  return getDb().transaction((tx) => store.addAllowlistEntry(tx, { type: "user", userId: principal.userId }, entry, note));
}

export async function removeTestAllowlistEntry(id: string) {
  const { principal } = await requireCapability("shop.manage");
  if (!UUID_RE.test(id)) throw new store.ShopSettingsError("not_found", "That entry was already removed.");
  return getDb().transaction((tx) => store.removeAllowlistEntry(tx, { type: "user", userId: principal.userId }, id));
}
