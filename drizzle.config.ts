import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so load .env ourselves when present.
try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
