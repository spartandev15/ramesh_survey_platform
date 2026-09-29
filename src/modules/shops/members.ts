import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Tx } from "@/db/client";
import { shopMembership, user } from "@/db/schema";
import { requireCapability } from "@/modules/access/principal";
import { recordAudit } from "@/modules/audit/audit";
import { getAuth } from "@/modules/auth/auth";

/**
 * Shop user access (SR-01). PSG adds people to a shop; they set their own
 * password from an emailed link, so no password is ever shown or shared.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberError";
  }
}

const memberInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  name: z.string().trim().min(2, "Enter the person's name").max(120),
});

export async function listMembers(shopId: string) {
  await requireCapability("psg.workspace");
  if (!UUID_RE.test(shopId)) return [];
  return getDb()
    .select({ userId: user.id, name: user.name, email: user.email, addedAt: shopMembership.createdAt })
    .from(shopMembership)
    .innerJoin(user, eq(user.id, shopMembership.userId))
    .where(eq(shopMembership.shopId, shopId))
    .orderBy(asc(user.name));
}

async function addMembership(tx: Tx, actorUserId: string | null, shopId: string, userId: string) {
  const [created] = await tx.insert(shopMembership).values({ userId, shopId }).onConflictDoNothing().returning();
  if (!created) throw new MemberError("This person already has access to this shop.");
  await recordAudit({ actorType: actorUserId ? "user" : "system", actorUserId, shopId, action: "shop_member.added", subjectType: "user", subjectId: userId }, tx);
}

async function removeMembership(tx: Tx, actorUserId: string | null, shopId: string, userId: string) {
  const [removed] = await tx.delete(shopMembership).where(and(eq(shopMembership.shopId, shopId), eq(shopMembership.userId, userId))).returning();
  if (!removed) throw new MemberError("This person no longer has access.");
  await recordAudit({ actorType: actorUserId ? "user" : "system", actorUserId, shopId, action: "shop_member.removed", subjectType: "user", subjectId: userId }, tx);
}

/** Give a person access to a shop, creating their account if needed, and email them a link to set a password. */
export async function addShopUser(shopId: string, input: { email: string; name: string }) {
  const { principal } = await requireCapability("user.manage");
  if (!UUID_RE.test(shopId)) throw new MemberError("Choose a shop.");
  const parsed = memberInputSchema.safeParse(input);
  if (!parsed.success) throw new MemberError(parsed.error.issues[0]?.message ?? "Check the details.");

  const ctx = await getAuth().$context;
  const existing = await ctx.internalAdapter.findUserByEmail(parsed.data.email);
  let userId: string;
  let created = false;
  if (existing) {
    userId = existing.user.id;
  } else {
    const account = await ctx.internalAdapter.createUser({ email: parsed.data.email, name: parsed.data.name, emailVerified: true }, { method: "admin" });
    // A random password nobody knows; the person sets their own from the email link.
    await ctx.internalAdapter.linkAccount({ userId: account.id, providerId: "credential", accountId: account.id, password: await ctx.password.hash(randomBytes(32).toString("base64url")) });
    userId = account.id;
    created = true;
  }
  await getDb().transaction((tx) => addMembership(tx, principal.userId, shopId, userId));
  if (created) await getAuth().api.requestPasswordReset({ body: { email: parsed.data.email, redirectTo: "/reset-password" } });
  return { created };
}

export async function removeShopUser(shopId: string, userId: string) {
  const { principal } = await requireCapability("user.manage");
  if (!UUID_RE.test(shopId)) throw new MemberError("Choose a shop.");
  await getDb().transaction((tx) => removeMembership(tx, principal.userId, shopId, userId));
}
