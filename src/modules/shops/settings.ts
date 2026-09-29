import "server-only";
import { getDb } from "@/db/client";
import { requireCapability } from "@/modules/access/principal";
import { listShopAdditionVersions } from "@/modules/instruments/store";
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

export async function getShopSettingsPage(shopId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(shopId)) return null;
  return getDb().transaction(async (tx) => {
    const view = await store.getSettings(tx, shopId);
    if (!view || view.shop.archivedAt) return null;
    const versions = await store.listAssignableVersions(tx);
    const history = await store.listSettingsHistory(tx, shopId);
    const additions = await listShopAdditionVersions(tx, shopId);
    return { ...view, versions, history, additions };
  });
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
  return getDb().transaction((tx) => store.changeMode(tx, { type: "user", userId: principal.userId }, shopId, expectedRevision, target));
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
