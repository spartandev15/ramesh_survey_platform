import {
  EmailAcceptanceUnknownError,
  EmailRejectedError,
  type EmailSendResult,
  type EmailTransport,
  type OutboundEmail,
} from "./transport";

const SENDGRID_SEND_URL = "https://api.sendgrid.com/v3/mail/send";

/**
 * SendGrid v3 transport. One attempt per call, no internal retry loop
 * (PDF: do not blindly reuse a retry loop that can duplicate messages).
 */
export class SendGridEmailTransport implements EmailTransport {
  readonly name = "sendgrid";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    const content = [{ type: "text/plain", value: message.text }];
    if (message.html) content.push({ type: "text/html", value: message.html });

    let response: Response;
    try {
      response = await fetch(SENDGRID_SEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: this.from },
          subject: message.subject,
          content,
          custom_args: message.correlationId ? { correlation_id: message.correlationId } : undefined,
          // Survey and auth emails must not carry third-party click/open tracking (PDF: security).
          tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // The request may have reached SendGrid before the connection dropped.
      throw new EmailAcceptanceUnknownError("SendGrid request did not complete", error);
    }

    if (response.status === 202) {
      return { providerMessageId: response.headers.get("x-message-id") };
    }
    if (response.status >= 500) {
      throw new EmailAcceptanceUnknownError(`SendGrid returned ${response.status}`);
    }
    // 4xx: request was rejected and nothing was queued.
    throw new EmailRejectedError(`SendGrid rejected the message (${response.status})`, response.status);
  }
}
