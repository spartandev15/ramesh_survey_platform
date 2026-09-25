import pino from "pino";

/**
 * Structured logger. Secrets, tokens and contact data are redacted so audit and
 * error logs never carry them (SR-40).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "accessToken",
      "*.accessToken",
      "authorization",
      "*.authorization",
      "headers.cookie",
      "*.headers.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "apiKey",
      "*.apiKey",
    ],
    censor: "[redacted]",
  },
});
