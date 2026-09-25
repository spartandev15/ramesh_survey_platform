/**
 * Apply pending SQL migrations from ./drizzle. Runs in CI and at container
 * start before the app, so every environment uses the same reviewed SQL.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "@/db/client";

async function main() {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
}

main()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
