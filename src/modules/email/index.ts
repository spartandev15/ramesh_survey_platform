import "server-only";
import { env } from "@/lib/env";
import { LogEmailTransport } from "./log-transport";
import { SendGridEmailTransport } from "./sendgrid-transport";
import type { EmailTransport } from "./transport";

export * from "./transport";

let transport: EmailTransport | undefined;

/** The configured provider. Switch providers with EMAIL_PROVIDER; callers never change. */
export function emailTransport(): EmailTransport {
  if (!transport) {
    const e = env();
    transport =
      e.EMAIL_PROVIDER === "sendgrid"
        ? new SendGridEmailTransport(e.SENDGRID_API_KEY!, e.EMAIL_FROM)
        : new LogEmailTransport();
  }
  return transport;
}
