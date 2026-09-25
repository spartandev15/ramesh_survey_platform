import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import type { EmailSendResult, EmailTransport, OutboundEmail } from "./transport";

/** Development transport: writes the email to the log instead of sending it. */
export class LogEmailTransport implements EmailTransport {
  readonly name = "log";

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const providerMessageId = `log-${randomUUID()}`;
    logger.info(
      { email: { to: message.to, subject: message.subject, correlationId: message.correlationId }, providerMessageId },
      `[email:log] ${message.subject}\n${message.text}`,
    );
    return { providerMessageId };
  }
}
