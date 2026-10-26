import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { getDb } from "@/db/client";
import { psgStaffRole, shop, shopMembership } from "@/db/schema";
import { getAuth } from "@/modules/auth/auth";
import { canReadShop, hasCapability, type Capability, type Principal } from "./capabilities";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "./errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CurrentUser {
  principal: Principal;
  name: string;
  email: string;
}

/**
 * Roles and memberships are always read from the database, never from the client.
 * A deleted (archived) shop is no longer one of its users' shops, so every shop page and action is closed to them.
 */
async function loadPrincipal(userId: string): Promise<Principal> {
  const db = getDb();
  const [roles, memberships] = await Promise.all([
    db.select({ role: psgStaffRole.role }).from(psgStaffRole).where(eq(psgStaffRole.userId, userId)),
    db
      .select({ shopId: shopMembership.shopId })
      .from(shopMembership)
      .innerJoin(shop, eq(shop.id, shopMembership.shopId))
      .where(and(eq(shopMembership.userId, userId), isNull(shop.archivedAt))),
  ]);
  return {
    userId,
    psgRoles: roles.map((r) => r.role),
    shopIds: memberships.map((m) => m.shopId),
  };
}

/** Current signed-in user for this request, or null. Memoized per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Read request headers first: this marks the route dynamic before auth touches env config at build time.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  return {
    principal: await loadPrincipal(session.user.id),
    name: session.user.name,
    email: session.user.email,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) throw new UnauthenticatedError();
  return current;
}

export async function requireCapability(capability: Capability): Promise<CurrentUser> {
  const current = await requireUser();
  if (!hasCapability(current.principal, capability)) throw new ForbiddenError();
  return current;
}

/**
 * Authorize reading one shop. Another tenant's shop and a malformed id both
 * return NotFound, so identifiers cannot be probed (AT-01).
 */
export async function requireShopRead(shopId: string): Promise<CurrentUser> {
  const current = await requireUser();
  if (!UUID_RE.test(shopId) || !canReadShop(current.principal, shopId)) throw new NotFoundError();
  return current;
}
