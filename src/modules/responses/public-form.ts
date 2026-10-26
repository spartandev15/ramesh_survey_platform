import "server-only";
import { getDb } from "@/db/client";
import { consumeRateLimit } from "@/lib/rate-limit";
import * as store from "./staff-store";

/**
 * Public shop survey (SR-13). The shop comes from the URL only; nothing is
 * looked up or returned about customers, so names or emails cannot be probed.
 */

export class PublicFormRateLimitedError extends Error {
  constructor() {
    super("Too many requests. Please wait a minute and try again.");
    this.name = "PublicFormRateLimitedError";
  }
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function loadPublicForm(slug: string) {
  if (!SLUG_RE.test(slug) || slug.length > 60) return null;
  return getDb().transaction((tx) => store.publicShopForm(tx, slug));
}

export async function submitPublicForm(address: string, input: { slug: string; versionId: string; additionVersionId: string | null; answers: unknown; context: unknown; requestKey: string }) {
  if (!(await consumeRateLimit(`survey:public:ip:${address}`, 10, 60))) throw new PublicFormRateLimitedError();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validAddition = input.additionVersionId === null || (typeof input.additionVersionId === "string" && uuid.test(input.additionVersionId));
  const valid = typeof input.slug === "string" && input.slug.length <= 60 && SLUG_RE.test(input.slug) && uuid.test(input.versionId) && validAddition && /^[A-Za-z0-9-]{8,64}$/.test(input.requestKey);
  if (!valid) return { ok: false as const, reason: "unavailable" as const };
  // The slug goes into the per-shop limit key only once it is known to be well formed.
  if (!(await consumeRateLimit(`survey:public:shop:${input.slug}`, 300, 60))) throw new PublicFormRateLimitedError();
  return getDb().transaction((tx) => store.submitPublic(tx, input));
}
