import "server-only";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { requireCapability } from "@/modules/access/principal";
import type { EmailFacts } from "./policy";
import * as store from "./store";

/** Authorized entry points for the launch readiness manifest (SR-37). Only admins record checks. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The shared sending setup, read from the server's own configuration, never from the browser. */
function emailFacts(): EmailFacts {
  const e = env();
  return { provider: e.EMAIL_PROVIDER, webhookKey: Boolean(e.SENDGRID_WEBHOOK_PUBLIC_KEY), from: e.EMAIL_FROM };
}

export async function getManifest() {
  await requireCapability("psg.workspace");
  return getDb().transaction((tx) => store.manifest(tx, emailFacts()));
}

export async function getShopReadiness(shopId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(shopId)) return null;
  const m = await getDb().transaction((tx) => store.manifest(tx, emailFacts(), shopId));
  return m.shops[0] ? { email: m.email, shop: m.shops[0] } : null;
}

export async function confirmReadinessItem(shopId: string, item: string, note: string) {
  const { principal } = await requireCapability("shop.manage");
  if (!UUID_RE.test(shopId)) throw new store.ReadinessError("not_found", "This shop no longer exists.");
  return getDb().transaction((tx) => store.confirmItem(tx, { type: "user", userId: principal.userId }, shopId, item, note.slice(0, 2000), emailFacts()));
}

export async function withdrawReadinessItem(shopId: string, item: string) {
  const { principal } = await requireCapability("shop.manage");
  if (!UUID_RE.test(shopId)) throw new store.ReadinessError("not_found", "This shop no longer exists.");
  return getDb().transaction((tx) => store.withdrawItem(tx, { type: "user", userId: principal.userId }, shopId, item));
}
