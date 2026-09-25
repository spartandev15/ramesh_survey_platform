import "server-only";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    APP_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    EMAIL_PROVIDER: z.enum(["log", "sendgrid"]).default("log"),
    EMAIL_FROM: z.email(),
    SENDGRID_API_KEY: z.string().optional(),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  })
  .refine((e) => e.EMAIL_PROVIDER !== "sendgrid" || !!e.SENDGRID_API_KEY, {
    message: "SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid",
    path: ["SENDGRID_API_KEY"],
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated server environment. Parsed lazily so `next build` does not need
 * production secrets; the first real request fails fast if config is wrong.
 */
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
