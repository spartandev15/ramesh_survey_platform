import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

/**
 * Only this app's own scripts, styles and fonts run (no third-party scripts
 * on survey pages). Shop logos may come from any https host. Inline script
 * and style are needed by Next.js hydration and the per-shop brand colour.
 * Development also needs eval and the reload socket, so it stays off there.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Self-contained server bundle so the app runs in Docker on any host.
  output: "standalone",
  // Node-only packages that must not be bundled into server chunks.
  serverExternalPackages: ["pg", "pg-boss", "pino"],
  // The only images are two small brand PNGs (27 KB together): serve them as they are. No optimizer means no
  // native image library in the bundle, so a build made on one platform runs on another (shared Linux hosting).
  images: { unoptimized: true },
  poweredByHeader: false,
  experimental: {
    // Import files are capped at 5 MB in the app; this leaves room for form overhead.
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Survey links carry access tokens in the path; never leak them via Referer (PDF: security and resilience).
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          ...(production
            ? [
                { key: "Content-Security-Policy", value: contentSecurityPolicy },
                // Browsers ignore this over plain http, so it is safe on a local production build too.
                { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
              ]
            : []),
        ],
      },
      {
        // Respondent pages show saved answers behind a bearer link: no shared cache may keep them (PDF 04, SR-40).
        source: "/survey/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
