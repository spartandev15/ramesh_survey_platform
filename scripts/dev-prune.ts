/**
 * Development only: hold the local database to the newest rows of each
 * growing table (100 by default), so it never grows during development.
 *
 *   npm run db:prune
 *   npm run db:prune -- 50
 */
import { getPool } from "@/db/client";
import { pruneDevData, pruneKeep } from "@/modules/devtools/prune";

async function main() {
  const keep = pruneKeep(process.argv[2]) ?? pruneKeep(process.env.DEV_PRUNE_KEEP) ?? 100;
  const removed = await pruneDevData(keep);
  const total = Object.values(removed).reduce((t, n) => t + n, 0);
  console.log(total === 0 ? `Nothing to remove: every table is within ${keep} rows.` : `Kept the newest ${keep} rows per table. Removed: ${JSON.stringify(removed)}`);
  // Let PostgreSQL reuse the freed space.
  await getPool().query("VACUUM");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
