import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle so the app runs in Docker on any host.
  output: "standalone",
  // Node-only packages that must not be bundled into server chunks.
  serverExternalPackages: ["pg", "pg-boss", "pino"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Survey links carry access tokens in the path; never leak them via Referer (PDF: security and resilience).
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
