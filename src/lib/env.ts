import "server-only";
import { z } from "zod";

/** `NAME=` in a .env file means "not set". */
const blankAsUnset = (v: unknown) => (v === "" ? undefined : v);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    APP_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    EMAIL_PROVIDER: z.enum(["log", "sendgrid"]).default("log"),
    EMAIL_FROM: z.email(),
    SENDGRID_API_KEY: z.string().optional(),
    // Base64 public key from SendGrid Event Webhook settings; without it the webhook refuses all requests.
    SENDGRID_WEBHOOK_PUBLIC_KEY: z.string().optional(),
    // PSG staff who get queue-health notices and the daily reconciliation (PDF 09), comma separated. Unset: notices are only logged.
    OPS_ALERT_EMAILS: z.string().optional(),
    // Where customers can ask for help when a survey link cannot be renewed (PDF 03 §3). Unset: they are told to contact the shop.
    SURVEY_HELP_EMAIL: z.preprocess(blankAsUnset, z.email().optional()),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
    // Proxies in front of the app that append to X-Forwarded-For (a CDN plus a load balancer is 2). Next.js keeps a
    // header the client sent, so the app must sit behind a proxy that sets it; never expose the app port directly.
    TRUSTED_PROXY_HOPS: z.preprocess(blankAsUnset, z.coerce.number().int().min(1).max(5).default(1)),
    // Signs opt-out links. Optional: derived from BETTER_AUTH_SECRET when unset. Set it before rotating that secret so sent links keep working.
    OPT_OUT_SECRET: z.preprocess(blankAsUnset, z.string().min(32, "OPT_OUT_SECRET must be at least 32 characters").optional()),
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
