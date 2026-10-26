import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import type { EmailSendResult, EmailTransport, OutboundEmail } from "./transport";

/** Survey, opt-out and password-reset links are bearer tokens: never write them to logs outside development (SR-40). */
export function redactSurveyLinks(text: string): string {
  return text
    .replace(/(\/survey\/(?:opt-out\/)?)[A-Za-z0-9_.-]{20,}/g, "$1[redacted]")
    .replace(/(\/reset-password\/)[^?\s/]+/g, "$1[redacted]")
    .replace(/([?&]token=)[^&\s]+/g, "$1[redacted]");
}

/** Development transport: writes the email to the log instead of sending it. */
export class LogEmailTransport implements EmailTransport {
  readonly name = "log";

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const providerMessageId = `log-${randomUUID()}`;
    // Developers need the link to test locally; a production build never logs it.
    const production = process.env.NODE_ENV === "production";
    const text = production ? redactSurveyLinks(message.text) : message.text;
    // The address is personal data: a production log keeps only its domain.
    const to = production ? message.to.replace(/^[^@]*/, "[redacted]") : message.to;
    logger.info({ email: { to, subject: message.subject, correlationId: message.correlationId }, providerMessageId }, `[email:log] ${message.subject}\n${text}`);
    return { providerMessageId };
  }
}
