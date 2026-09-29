import { z } from "zod";
import { MODE_LABELS } from "./fields";

/**
 * Shop survey settings rules (SR-02..SR-05, SR-26). Pure logic with no I/O so
 * every rule is unit-tested; the store applies them inside a transaction and
 * database triggers enforce the most important ones again.
 */

export const SHOP_MODES = ["test", "live", "paused"] as const;
export type ShopMode = (typeof SHOP_MODES)[number];

// Defaults (D-07: reminder after 7 days; D-09: 90-day links) live in the shop_survey_settings column defaults.
const MAX_ALERT_RECIPIENTS = 20;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written as YYYY-MM-DD. Impossible dates such as 2026-02-30 are rejected. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Inclusive delivery cutoff (SR-05, AT-05): a delivery on the cutoff date
 * qualifies, one day earlier does not. Both values are shop-local calendar
 * dates, compared as dates with no timezone conversion.
 */
export function meetsDeliveryCutoff(deliveryDate: string, cutoff: string): boolean {
  if (!isIsoDate(deliveryDate) || !isIsoDate(cutoff)) return false;
  return deliveryDate >= cutoff;
}

/** Today's calendar date in the shop's timezone, used as the suggested cutoff. */
export function todayInTimezone(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Blank means "not set". */
const optionalText = (schema: z.ZodType<string, string>) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(schema.nullable());

export const settingsInputSchema = z.object({
  instrumentVersionId: optionalText(z.uuid("Choose a published survey version")),
  deliveryCutoff: optionalText(z.string().refine(isIsoDate, "Enter a real date")),
  timezone: z.string().trim().refine(isValidTimezone, "Choose a valid timezone"),
  reminderDelayDays: z.coerce.number().int("Use whole days").min(1, "Use at least 1 day").max(60, "Use at most 60 days"),
  linkLifetimeDays: z.coerce.number().int("Use whole days").min(1, "Use at least 1 day").max(365, "Use at most 365 days"),
  alertRecipients: z
    .array(z.string().trim().toLowerCase().pipe(z.email("Each alert recipient must be an email address")))
    .max(MAX_ALERT_RECIPIENTS, `Use at most ${MAX_ALERT_RECIPIENTS} alert recipients`)
    .transform((list) => [...new Set(list)]),
  // Shop logos are shown to customers, so only secure links are accepted (SR-02).
  logoUrl: optionalText(z.url("Enter a full https:// link").max(500).refine((v) => v.startsWith("https://"), "Use an https:// link")),
  brandColor: optionalText(z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a2b3c")),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

/** Split a textarea of recipients on commas, semicolons and new lines. */
export function splitRecipients(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface VersionFacts {
  status: "draft" | "published";
  isTest: boolean;
}

export interface ModeContext {
  mode: ShopMode;
  isTestShop: boolean;
  activatedAt: Date | null;
  deliveryCutoff: string | null;
  version: VersionFacts | null;
}

/**
 * Why a mode change is not allowed; empty when it is. Changing mode never
 * sends anything by itself (SR-04): the waiting queue needs explicit selection.
 */
export function modeChangeIssues(ctx: ModeContext, target: ShopMode): string[] {
  if (ctx.mode === target) return [`The shop is already in ${MODE_LABELS[target]} mode.`];
  const issues: string[] = [];
  if (target === "live") {
    if (ctx.isTestShop) issues.push("An internal test shop always stays in Test mode.");
    if (!ctx.deliveryCutoff) issues.push("Set the delivery cutoff date first.");
    if (!ctx.version) issues.push("Assign a published survey version first.");
    else if (ctx.version.status !== "published") issues.push("The assigned survey version is not published.");
    // AT-14: test content never reaches Live customers.
    else if (ctx.version.isTest) issues.push("The assigned version is a TEST version. Publish a verified version from PSG-approved content first.");
  }
  if (target === "paused" && ctx.mode !== "live") issues.push("Only a Live shop can be paused.");
  // Proposal: once a shop has been Live, Test would mix test and production
  // records in one shop (SR-03), so Paused is the way to stop outreach.
  if (target === "test" && ctx.activatedAt) issues.push("A shop that has been Live cannot return to Test. Pause it instead.");
  return issues;
}

/** Why saved settings are not allowed in the current mode; empty when they are. */
export function settingsIssues(mode: ShopMode, input: Pick<SettingsInput, "deliveryCutoff">, version: VersionFacts | null): string[] {
  const issues: string[] = [];
  if (version && version.status !== "published") issues.push("Only a published survey version can be assigned.");
  if (mode !== "test") {
    if (!input.deliveryCutoff) issues.push(`A ${MODE_LABELS[mode]} shop needs a delivery cutoff date.`);
    if (!version) issues.push(`A ${MODE_LABELS[mode]} shop needs an assigned survey version.`);
    else if (version.isTest) issues.push(`A ${MODE_LABELS[mode]} shop cannot use a TEST survey version.`);
  }
  return issues;
}

export type SendKind = "initial" | "reminder" | "renewal";
export type DispatchBlock = "SHOP_PAUSED" | "TEST_RECIPIENT_NOT_ALLOWED";

/**
 * Checked by the email dispatcher at send time, not only when a send is
 * queued (SR-26). Test mode and test records reach only allowlisted internal
 * addresses (SR-03, AT-03). Paused stops invitations and reminders; a renewal
 * the respondent asked for may still go out so they can finish (proposal, G-06).
 */
export function dispatchBlock(input: { mode: ShopMode; kind: SendKind; isTestRecord: boolean; recipientAllowlisted: boolean }): DispatchBlock | null {
  if ((input.mode === "test" || input.isTestRecord) && !input.recipientAllowlisted) return "TEST_RECIPIENT_NOT_ALLOWED";
  if (input.mode === "paused" && input.kind !== "renewal") return "SHOP_PAUSED";
  return null;
}

/** An allowlist entry is one full address or a whole domain written as "@domain". */
export const allowlistEntrySchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => (v.startsWith("@") ? /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) : z.email().safeParse(v).success), "Enter an email address or a domain like @phoenixsolutionsgroup.net");

/** Exact address or exact domain match; subdomains and look-alike suffixes do not match. */
export function matchesTestAllowlist(email: string, entries: readonly string[]): boolean {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1) return false;
  const domain = address.slice(at);
  return entries.some((entry) => entry === address || entry === domain);
}
