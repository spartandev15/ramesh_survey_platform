import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db/client";
import * as authSchema from "@/db/schema/auth";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { emailTransport } from "@/modules/email";

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "PSG Survey",
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      // No public registration: PSG creates staff and shop accounts.
      disableSignUp: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        // Not awaited, so response timing does not reveal whether the account exists.
        void emailTransport()
          .send({
            to: user.email,
            subject: "Reset your PSG Survey password",
            text: `A password reset was requested for your PSG Survey account.\n\nReset your password: ${url}\n\nThis link expires in 1 hour. If you did not request it, you can ignore this email.`,
          })
          .catch((error: unknown) => logger.error({ err: error, userId: user.id }, "password reset email failed"));
      },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    // nextCookies must be the last plugin so server actions can set auth cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { psgAuth?: Auth };

/** Created lazily so `next build` does not require runtime secrets. */
export function getAuth(): Auth {
  globalForAuth.psgAuth ??= createAuth();
  return globalForAuth.psgAuth;
}
