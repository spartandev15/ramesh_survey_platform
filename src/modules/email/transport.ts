export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Opaque correlation id echoed in provider events (e.g. an email intent id). */
  correlationId?: string;
}

export interface EmailSendResult {
  providerMessageId: string | null;
}

/** The provider definitely did not accept the message; the same intent may be retried. */
export class EmailRejectedError extends Error {
  constructor(message: string, readonly providerStatus?: number) {
    super(message);
    this.name = "EmailRejectedError";
  }
}

/**
 * The provider may or may not have accepted the message (timeout, network
 * failure, 5xx). Never blindly resend; reconcile first (SR-23, PDF: email delivery semantics).
 */
export class EmailAcceptanceUnknownError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmailAcceptanceUnknownError";
  }
}

/**
 * Provider boundary. Transports make exactly one attempt and never retry;
 * retry policy belongs to the durable email ledger, not the adapter.
 */
export interface EmailTransport {
  readonly name: string;
  send(message: OutboundEmail): Promise<EmailSendResult>;
}
