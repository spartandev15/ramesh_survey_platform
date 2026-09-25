/**
 * Load the DEMO survey (TEST) and publish version 1 as a test version, for
 * development and internal testing. Safe to run repeatedly.
 *
 *   npm run seed:demo
 *
 * This is placeholder content, not the PSG instrument (gate G-01).
 */
import { eq } from "drizzle-orm";
import { getDb, getPool } from "@/db/client";
import { instrument } from "@/db/schema";
import { DEMO_INSTRUMENT, demoDefinition } from "@/modules/instruments/demo-definition";
import { insertInstrument, publishVersion } from "@/modules/instruments/store";

async function main() {
  await getDb().transaction(async (tx) => {
    const [existing] = await tx.select({ id: instrument.id }).from(instrument).where(eq(instrument.key, DEMO_INSTRUMENT.key));
    if (existing) {
      console.log(`Demo survey already exists (${existing.id}); nothing to do.`);
      return;
    }
    const actor = { type: "system" } as const;
    const { instrument: created, draft } = await insertInstrument(
      tx,
      actor,
      { key: DEMO_INSTRUMENT.key, name: DEMO_INSTRUMENT.name, description: DEMO_INSTRUMENT.description },
      demoDefinition,
      "Demo placeholder content for development. Not PSG source material.",
    );
    const published = await publishVersion(tx, actor, draft.id, draft.revision, { isTest: true });
    console.log(`Created "${created.name}" and published version ${published.version} as a TEST version.`);
    console.log(`Definition hash: ${published.definitionHash}`);
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
