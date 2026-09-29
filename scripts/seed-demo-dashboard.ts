/**
 * Demo data for the survey dashboard, development and staging only. Creates
 * an internal test shop, "Demo Collision (internal test)", and about six
 * months of dummy responses from the demo TEST survey (placeholder content,
 * never the PSG instrument, G-01). Everything goes through the normal
 * submission code, so scores and alerts are computed as in production.
 * Internal test data never enters a production shop's reports (SR-03).
 * It also loads docs/sample-data/visits.csv as a test import and a year of
 * dummy history (in place of the Supabase history, G-03) before the Hub
 * responses start. Each part runs once. It refuses to run in production.
 *
 *   npm run seed:demo            (once: the demo survey)
 *   npm run seed:dashboard       (then this; it does nothing when the shop already has responses)
 */
import { readFileSync } from "node:fs";
import { and, count, eq, sql } from "drizzle-orm";
import { getDb, getPool } from "@/db/client";
import { historicalResponse, importBatch, instrument, instrumentVersion, shop, shopSurveySettings, surveyResponse } from "@/db/schema";
import { commitBatch, createBatch } from "@/modules/imports/store";
import { submitPaper, submitPublic } from "@/modules/responses/staff-store";
import { createTestInvitation, submitResponse } from "@/modules/responses/store";
import { insertDefaultSettings } from "@/modules/shops/settings-store";

const SLUG = "demo-collision";
const DAYS = 182;
const DAY = 86_400_000;
const system = { type: "system" } as const;

/** Repeatable pseudo-random numbers, so every seeded database looks the same. */
function random(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}
const rand = random(20260928);
const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];

/** A plausible set of demo answers; satisfaction improves slowly over the six months. */
function answers(progress: number) {
  const happy = rand() < 0.62 + progress * 0.22;
  const rating = happy ? pick([4, 5, 5]) : pick([1, 2, 3, 3]);
  const onTime = happy ? rand() < 0.93 : rand() < 0.55;
  const aspect = () => (happy ? pick(["good", "excellent", "excellent"]) : pick(["poor", "fair", "fair", "good"]));
  const recommend = happy ? pick([8, 9, 9, 10, 10]) : pick([2, 4, 5, 6, 7]);
  return {
    overall_rating: rating,
    ready_on_time: onTime ? "yes" : "no",
    ...(onTime ? {} : { delay_detail: pick(["One day late", "Parts arrived late", "Two days later than promised"]) }),
    service_aspects: { communication: aspect(), quality: aspect(), cleanliness: aspect() },
    recommend_score: recommend,
    ...(recommend <= 6 ? { improve_areas: [pick(["updates", "timing", "quality", "billing"])] } : {}),
  };
}

/** A year of dummy history on its own scales, before the Hub responses start (SR-30). */
async function seedHistory(shopId: string, before: number) {
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(historicalResponse).where(eq(historicalResponse.shopId, shopId));
  if (n > 0) return 0;
  const rows = [];
  for (let day = 1; day <= 365; day++) {
    if (rand() < 0.45) continue;
    const happy = rand() < 0.7;
    rows.push({
      shopId,
      sourceSystem: "supabase",
      sourceRef: `demo-h-${day}`,
      respondedOn: new Date(before - day * DAY).toISOString().slice(0, 10),
      measures: { overall: { value: happy ? pick([4, 5]) : pick([1, 2, 3]), scale: "1-5" }, recommend: { value: rand() < 0.1 ? null : happy ? pick([8, 9, 10]) : pick([3, 5, 6]), scale: "0-10" } },
    });
  }
  await db.insert(historicalResponse).values(rows);
  return rows.length;
}

/** The sample visit file, imported as test data through the normal preview and commit. */
async function seedImport(shopId: string) {
  const db = getDb();
  const fileName = "visits.csv";
  const [done] = await db.select({ id: importBatch.id }).from(importBatch).where(and(eq(importBatch.shopId, shopId), eq(importBatch.fileName, fileName)));
  if (done) return null;
  const content = readFileSync("docs/sample-data/visits.csv", "utf8");
  return db.transaction(async (tx) => {
    const batch = await createBatch(tx, system, { shopId, kind: "visits", isTest: true, sourceSystem: "shop_documents", fileName, content });
    await commitBatch(tx, system, batch.id, batch.revision);
    return batch.rowCount;
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo data is for development and staging only.");
  const db = getDb();
  const { demoShop, versionId } = await db.transaction(async (tx) => {
    let [s] = await tx.select().from(shop).where(eq(shop.publicSlug, SLUG));
    if (!s) {
      [s] = await tx.insert(shop).values({ name: "Demo Collision (internal test)", publicSlug: SLUG, isTestShop: true, timezone: "America/Chicago" }).returning();
      await insertDefaultSettings(tx, s.id);
    }
    const [v] = await tx
      .select({ id: instrumentVersion.id })
      .from(instrumentVersion)
      .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
      .where(and(eq(instrument.key, "demo_survey"), eq(instrumentVersion.status, "published")))
      .orderBy(sql`${instrumentVersion.version} DESC`)
      .limit(1);
    if (!v) throw new Error("Run `npm run seed:demo` first: the dashboard demo uses the demo survey.");
    await tx.update(shopSurveySettings).set({ instrumentVersionId: v.id }).where(eq(shopSurveySettings.shopId, s.id));
    return { demoShop: s, versionId: v.id };
  });

  const [{ n }] = await db.select({ n: count() }).from(surveyResponse).where(and(eq(surveyResponse.shopId, demoShop.id), eq(surveyResponse.status, "submitted")));
  const start = Date.now() - DAYS * DAY;
  const history = await seedHistory(demoShop.id, start);
  if (history) console.log(`Dummy history: ${history} responses before ${new Date(start).toISOString().slice(0, 10)}.`);
  const imported = await seedImport(demoShop.id);
  if (imported) console.log(`Sample import: ${imported} visit rows committed as test data.`);
  if (n > 0) {
    console.log(`"${demoShop.name}" already has ${n} responses.`);
    return;
  }

  let online = 0, paper = 0, pub = 0, failed = 0;
  for (let day = 0; day <= DAYS; day++) {
    const progress = day / DAYS;
    const weekday = new Date(start + day * DAY).getUTCDay();
    // Busier on weekdays, and a little busier as the shop grows.
    const perDay = weekday === 0 ? 0 : weekday === 6 ? 1 : 2 + Math.round(rand() * 3 + progress * 2);
    for (let i = 0; i < perDay; i++) {
      const at = new Date(Math.min(start + day * DAY + (9 + rand() * 8) * 3_600_000, Date.now() - 60_000));
      const roll = rand();
      await db.transaction(async (tx) => {
        const key = `demo-${day}-${i}`;
        if (roll < 0.72) {
          const link = await createTestInvitation(tx, system, { shopId: demoShop.id, instrumentVersionId: versionId, lifetimeDays: 400, now: at });
          const result = await submitResponse(tx, link.token, key, answers(progress), at);
          if (result.ok) online++;
          else failed++;
        } else if (roll < 0.84) {
          await submitPaper(tx, system, { shopId: demoShop.id, visitId: null, receivedOn: at.toISOString().slice(0, 10), answers: answers(progress), requestKey: key }, at);
          paper++;
        } else {
          const result = await submitPublic(tx, { slug: SLUG, versionId, answers: answers(progress), context: { name: "Demo customer" }, requestKey: key }, at);
          if (result.ok) pub++;
          else failed++;
        }
      });
    }
  }
  console.log(`"${demoShop.name}": ${online} online, ${paper} paper, ${pub} public responses over ${DAYS} days${failed ? `, ${failed} rejected` : ""}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
