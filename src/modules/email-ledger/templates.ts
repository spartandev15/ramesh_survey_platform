import type { SendKind } from "@/modules/shops/settings-policy";

/**
 * Survey email content. DRAFT wording for PSG approval: calm, short, and
 * about the customer's repair, with no promotions. Shop-branded (SR-02, SR-23).
 */

export interface EmailContext {
  kind: SendKind;
  isTest: boolean;
  shopName: string;
  brandColor: string | null;
  firstName: string | null;
  surveyUrl: string;
  optOutUrl: string;
  expiresAt: Date;
  timezone: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function copy(c: EmailContext) {
  const until = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: c.timezone }).format(c.expiresAt);
  switch (c.kind) {
    case "initial":
      return {
        subject: `How did your repair at ${c.shopName} go?`,
        paragraphs: [
          `Thank you for trusting ${c.shopName} with your vehicle.`,
          `We would like to hear how your repair went. The survey takes a few minutes, and your answers help the team know what is working and what to improve.`,
        ],
        action: "Start the survey",
        closing: `This link is personal to your visit and stays open until ${until}.`,
      };
    case "reminder":
      return {
        subject: `A reminder: your survey for ${c.shopName}`,
        paragraphs: [`We sent you a short survey about your recent repair at ${c.shopName}. If you have a few minutes, we would still like to hear from you.`, `Any answers you already saved are still there.`],
        action: "Continue the survey",
        closing: `The survey stays open until ${until}. This is the only reminder we will send.`,
      };
    case "renewal":
      return {
        subject: `Your new survey link for ${c.shopName}`,
        paragraphs: [`Here is the new link you asked for. Any answers you already saved are still there.`],
        action: "Open the survey",
        closing: `This new link stays open until ${until}. Earlier links for this survey no longer work.`,
      };
  }
}

export function renderEmail(c: EmailContext): { subject: string; text: string; html: string } {
  const body = copy(c);
  const subject = `${c.isTest ? "[TEST] " : ""}${body.subject}`;
  const greeting = c.firstName ? `Hi ${c.firstName},` : "Hello,";
  const optOut = `If you would rather not get survey emails from ${c.shopName}, you can opt out: ${c.optOutUrl}`;

  const text = [greeting, "", ...body.paragraphs.flatMap((p) => [p, ""]), `${body.action}: ${c.surveyUrl}`, "", body.closing, "", `${c.shopName}`, "", optOut].join("\n");

  const color = c.brandColor && /^#[0-9a-f]{6}$/i.test(c.brandColor) ? c.brandColor : "#001c3d";
  const p = (t: string) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:${color};color:#ffffff;padding:16px 20px;border-radius:8px 8px 0 0;font-size:18px;font-weight:bold">${escapeHtml(c.shopName)}</div>
<div style="background:#ffffff;padding:24px 20px;border-radius:0 0 8px 8px">
${c.isTest ? p("TEST EMAIL: internal testing only.") : ""}${p(greeting)}${body.paragraphs.map(p).join("")}
<p style="margin:24px 0"><a href="${escapeHtml(c.surveyUrl)}" style="background:${color};color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(body.action)}</a></p>
${p(body.closing)}
</div>
<p style="font-size:12px;color:#6b7280;line-height:1.5;margin:16px 4px">If you would rather not get survey emails from ${escapeHtml(c.shopName)}, <a href="${escapeHtml(c.optOutUrl)}" style="color:#6b7280">opt out here</a>.</p>
</div></body></html>`;
  return { subject, text, html };
}

/**
 * The PSG-approved alert email to a shop (SR-33). DRAFT wording for PSG
 * approval. It names what needs attention and links to the Hub page; the
 * customer's answers and contact details stay in Hub (PDF 04).
 */
export function renderAlertEmail(c: { isTest: boolean; shopName: string; brandColor: string | null; alerts: string[]; detailUrl: string }) {
  const subject = `${c.isTest ? "[TEST] " : ""}Customer feedback needs your attention`;
  const intro = `A recent customer survey for ${c.shopName} raised something PSG has reviewed and wants you to see.`;
  const next = "Open the response in PSG Hub to read the full answers, add your follow-up notes and request closure once it is handled.";
  const text = [intro, "", "What needs attention:", ...c.alerts.map((a) => `- ${a}`), "", next, "", `Open the response: ${c.detailUrl}`, "", "PSG"].join("\n");

  const color = c.brandColor && /^#[0-9a-f]{6}$/i.test(c.brandColor) ? c.brandColor : "#001c3d";
  const p = (t: string) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:${color};color:#ffffff;padding:16px 20px;border-radius:8px 8px 0 0;font-size:18px;font-weight:bold">${escapeHtml(c.shopName)}</div>
<div style="background:#ffffff;padding:24px 20px;border-radius:0 0 8px 8px">
${c.isTest ? p("TEST EMAIL: internal testing only.") : ""}${p(intro)}
<p style="margin:0 0 8px;font-weight:bold">What needs attention</p>
<ul style="margin:0 0 16px;padding-left:20px;line-height:1.5">${c.alerts.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
${p(next)}
<p style="margin:24px 0"><a href="${escapeHtml(c.detailUrl)}" style="background:${color};color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Open the response</a></p>
</div></div></body></html>`;
  return { subject, text, html };
}
