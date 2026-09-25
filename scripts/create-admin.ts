/**
 * Create (or promote) a PSG administrator. Public sign-up is disabled, so this
 * is how the first account is created on a new environment.
 *
 *   npm run create-admin -- admin@example.com "Admin Name"
 *
 * Set ADMIN_PASSWORD to choose the password; otherwise a random one is printed once.
 */
import { randomBytes } from "node:crypto";
import { getDb, getPool } from "@/db/client";
import { psgStaffRole } from "@/db/schema";
import { getAuth } from "@/modules/auth/auth";
import { recordAudit } from "@/modules/audit/audit";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  if (!email || !name) {
    console.error('Usage: npm run create-admin -- <email> "<full name>"');
    process.exit(1);
  }

  const ctx = await getAuth().$context;
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await ctx.internalAdapter.findUserByEmail(normalizedEmail);

  let userId: string;
  let generatedPassword: string | null = null;

  if (existing) {
    userId = existing.user.id;
    console.log(`User ${normalizedEmail} already exists; granting psg_admin.`);
  } else {
    const password = process.env.ADMIN_PASSWORD ?? (generatedPassword = randomBytes(12).toString("base64url"));
    if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");
    const user = await ctx.internalAdapter.createUser({ email: normalizedEmail, name, emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await ctx.password.hash(password),
    });
    userId = user.id;
    console.log(`Created user ${normalizedEmail}.`);
  }

  await getDb().transaction(async (tx) => {
    const inserted = await tx.insert(psgStaffRole).values({ userId, role: "psg_admin" }).onConflictDoNothing().returning();
    if (inserted.length > 0) {
      await recordAudit(
        { actorType: "system", action: "psg_role.granted", subjectType: "user", subjectId: userId, after: { role: "psg_admin", via: "create-admin script" } },
        tx,
      );
    }
  });

  if (generatedPassword) {
    console.log(`\nTemporary password (shown once): ${generatedPassword}\nSign in and change it from "Forgot password".`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
