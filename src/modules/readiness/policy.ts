/**
 * Launch readiness per shop (SR-37; PDF 09 per-shop activation manifest).
 * Pure logic so every rule is unit-tested. A shop is ready only when every
 * required check passes now; nothing here switches a shop to Live.
 */

export const MANUAL_ITEMS = ["mapping", "branding", "history", "opt_outs", "internal_test", "acceptance"] as const;
export type ManualItem = (typeof MANUAL_ITEMS)[number];

export const isManualItem = (value: string): value is ManualItem => (MANUAL_ITEMS as readonly string[]).includes(value);

export const MANUAL_LABELS: Record<ManualItem, { label: string; help: string }> = {
  mapping: { label: "Company mapping confirmed", help: "This shop is the right Hub and FileMaker company, so results and history land on the right shop." },
  branding: { label: "Branding approved", help: "The shop approved the name, logo and colour customers will see." },
  history: { label: "Historical results reconciled", help: "A sample of historical counts matches the trusted source (SR-30)." },
  opt_outs: { label: "Existing opt-outs loaded", help: "Customers who already asked not to be surveyed by this shop are on file." },
  internal_test: { label: "Internal test passed", help: "An end-to-end test with internal addresses worked for this shop's setup." },
  acceptance: { label: "PSG accepted for launch", help: "Final sign-off. Allowed only when every other check passes." },
};

export type CheckStatus = "pass" | "fail" | "info";

export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Recorded by a person: who, when and their note. */
  confirmation?: { by: string; at: Date; note: string };
}

export interface ShopFacts {
  mode: "test" | "live" | "paused";
  activatedAt: Date | null;
  deliveryCutoff: string | null;
  version: { label: string; status: "draft" | "published"; isTest: boolean } | null;
  alertRecipients: number;
  legacyCoverageConfirmedAt: Date | null;
  unsentVisits: number;
  outstandingSuppression: number;
  confirmations: Partial<Record<ManualItem, { by: string; at: Date; note: string }>>;
}

export interface EmailFacts {
  provider: "log" | "sendgrid";
  webhookKey: boolean;
  from: string;
}

/** Sending setup shared by every shop (PDF 09: sender identity, signed receipts; gate G-08). */
export function emailChecks(email: EmailFacts): Check[] {
  return [
    {
      key: "email_provider",
      label: "Real email provider",
      status: email.provider === "sendgrid" ? "pass" : "fail",
      detail: email.provider === "sendgrid" ? `SendGrid, sending as ${email.from}` : "Emails are only written to the server log. Set EMAIL_PROVIDER=sendgrid with the production key.",
    },
    {
      key: "email_receipts",
      label: "Signed delivery receipts",
      status: email.webhookKey ? "pass" : "fail",
      detail: email.webhookKey ? "SendGrid webhook key set: delivered and bounced states are recorded." : "Set SENDGRID_WEBHOOK_PUBLIC_KEY so delivery and bounces are recorded.",
    },
  ];
}

export function shopChecks(f: ShopFacts): Check[] {
  const manual = (item: ManualItem): Check => {
    const c = f.confirmations[item];
    return { key: item, label: MANUAL_LABELS[item].label, status: c ? "pass" : "fail", detail: MANUAL_LABELS[item].help, confirmation: c };
  };
  const version: Check = !f.version
    ? { key: "version", label: "Verified survey version", status: "fail", detail: "No survey version assigned." }
    : f.version.status !== "published" || f.version.isTest
      ? { key: "version", label: "Verified survey version", status: "fail", detail: `${f.version.label} is a TEST version. Publish the PSG-verified questions first (G-01).` }
      : { key: "version", label: "Verified survey version", status: "pass", detail: f.version.label };
  return [
    manual("mapping"),
    version,
    { key: "cutoff", label: "Delivery cutoff", status: f.deliveryCutoff ? "pass" : "fail", detail: f.deliveryCutoff ? `Delivered on or after ${f.deliveryCutoff}` : "Set the inclusive delivery cutoff date." },
    { key: "recipients", label: "Alert recipients", status: f.alertRecipients > 0 ? "pass" : "fail", detail: f.alertRecipients > 0 ? `${f.alertRecipients} saved` : "Add at least one address for PSG-approved alerts." },
    {
      key: "legacy",
      label: "Legacy survey history loaded",
      status: f.legacyCoverageConfirmedAt ? "pass" : "fail",
      detail: f.legacyCoverageConfirmedAt ? "Confirmed: visits already surveyed are excluded." : "Until confirmed, production visits are held so no one is surveyed twice.",
    },
    manual("branding"),
    manual("history"),
    manual("opt_outs"),
    manual("internal_test"),
    {
      key: "unsent",
      label: "Imported visits not sent yet",
      status: "info",
      detail: f.unsentVisits === 0 ? "None." : `${f.unsentVisits} visit${f.unsentVisits === 1 ? "" : "s"}: after going Live, select which to send in Invitations. Going Live sends none of them.`,
    },
    {
      key: "suppression",
      label: "Outstanding suppression changes",
      status: "info",
      detail: f.outstandingSuppression === 0 ? "None." : `${f.outstandingSuppression} to apply in FileMaker (Suppression queue).`,
    },
    manual("acceptance"),
  ];
}

/** Required checks that fail now, in display order. Acceptance is left out when asked, to decide whether it may be given. */
export function blockers(checks: Check[], options: { exceptAcceptance?: boolean } = {}): Check[] {
  return checks.filter((c) => c.status === "fail" && !(options.exceptAcceptance && c.key === "acceptance"));
}

export const isReady = (shop: Check[], email: Check[]) => blockers([...email, ...shop]).length === 0;
