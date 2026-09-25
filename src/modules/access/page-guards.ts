import "server-only";
import { notFound, redirect } from "next/navigation";
import type { Capability } from "./capabilities";
import { UnauthenticatedError, isAccessError } from "./errors";
import { requireCapability, requireShopRead, type CurrentUser } from "./principal";

/**
 * Page-level wrappers around the access checks: signed-out users go to sign-in,
 * everything else the user may not see is a plain 404.
 */
async function guard(check: () => Promise<CurrentUser>): Promise<CurrentUser> {
  try {
    return await check();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    if (isAccessError(error)) notFound();
    throw error;
  }
}

export function pageRequireCapability(capability: Capability) {
  return guard(() => requireCapability(capability));
}

export function pageRequireShopRead(shopId: string) {
  return guard(() => requireShopRead(shopId));
}
