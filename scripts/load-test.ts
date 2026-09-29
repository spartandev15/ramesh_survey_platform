/**
 * Load and correctness check (SR-48, AT-48). Development and staging only:
 * it creates TEST data in an internal test shop ("Load test (internal)"),
 * which never enters production reports and can only email allowlisted
 * internal addresses.
 *
 *   npm run load-test -- --customers 200 --concurrency 25
 *
 * Each simulated customer arrives from their own address, autosaves twice
 * and submits twice (a double click), through the same rate-limited entry
 * points the survey page uses. Then dashboards are read while the email
 * worker sends one invitation per imported visit. Proposed targets (PDF 07,
 * to confirm against real volumes, G-05): save and submit p95 within 2 s, a
 * submitted result on the dashboard within 5 s, each eligible email within
 * 5 minutes. It exits 1 if a target is missed or an invariant breaks: a lost
 * or duplicated submission, a duplicate email, or another shop seeing the data.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { getDb, getPool } from "@/db/client";
import { emailIntent, instrument, instrumentVersion, invitation, shop, shopSurveySettings, surveyResponse, testRecipientAllowlist } from "@/db/schema";
import { parseFilters } from "@/modules/dashboard/cohort";
import { cohortRows } from "@/modules/dashboard/store";
import { commitBatch, createBatch } from "@/modules/imports/store";
import { saveSurveyDraft, submitSurvey } from "@/modules/responses/respondent";
import { createTestInvitation } from "@/modules/responses/store";
import { insertDefaultSettings } from "@/modules/shops/settings-store";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const CUSTOMERS = arg("customers", 200);
const CONCURRENCY = arg("concurrency", 25);
const EMAILS = arg("emails", 100);
const SLUG = "load-test-internal";
const DOMAIN = "@load-test.invalid";
const system = { type: "system" } as const;

const answers = { overall_rating: 4, ready_on_time: "yes", service_aspects: { communication: "good", quality: "excellent", cleanliness: "good" }, recommend_score: 9 };

async function pool<T>(items: T[], size: number, work: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await work(items[i], i);
      }
    }),
  );
}

const pct = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const timed = async <T>(into: number[], fn: () => Promise<T>) => {
  const t = performance.now();
  const result = await fn();
  into.push(performance.now() - t);
  return result;
};

async function setup() {
  const db = getDb();
  return db.transaction(async (tx) => {
    let [s] = await tx.select().from(shop).where(eq(shop.publicSlug, SLUG));
    if (!s) {
      [s] = await tx.insert(shop).values({ name: "Load test (internal)", publicSlug: SLUG, isTestShop: true }).returning();
      await insertDefaultSettings(tx, s.id);
    }
    // The demo survey's latest TEST version: placeholder content only (G-01).
    const [v] = await tx
      .select({ id: instrumentVersion.id })
      .from(instrumentVersion)
      .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
      .where(and(eq(instrument.key, "demo_survey"), eq(instrumentVersion.status, "published")))
      .orderBy(sql`${instrumentVersion.version} DESC`)
      .limit(1);
    if (!v) throw new Error("Run `npm run seed:demo` first: the load test uses the demo survey.");
    await tx.update(shopSurveySettings).set({ instrumentVersionId: v.id }).where(eq(shopSurveySettings.shopId, s.id));
    await tx.insert(testRecipientAllowlist).values({ entry: DOMAIN, note: "Load test addresses (never delivered)" }).onConflictDoNothing();
    return { shop: s, versionId: v.id };
  });
}

async function main() {
  const results: { check: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail: string) => results.push({ check: name, ok, detail });

  const { shop: loadShop, versionId } = await setup();
  const db = getDb();
  console.log(`Load test: ${CUSTOMERS} customers, ${CONCURRENCY} at a time, ${EMAILS} emails, shop "${loadShop.name}"`);

  // 1. Invitations with personal links.
  const tokens: string[] = [];
  const invitationIds: string[] = [];
  for (let i = 0; i < CUSTOMERS; i++) {
    const created = await db.transaction((tx) => createTestInvitation(tx, system, { shopId: loadShop.id, instrumentVersionId: versionId, lifetimeDays: 1 }));
    tokens.push(created.token);
    invitationIds.push(created.invitationId);
  }

  // 2. Customers autosave twice and submit twice at the same time.
  const saves: number[] = [];
  const submits: number[] = [];
  const acknowledged = new Set<string>();
  let failures = 0;
  const started = performance.now();
  await pool(tokens, CONCURRENCY, async (token, i) => {
    const address = `load-${i}`;
    const first = await timed(saves, () => saveSurveyDraft(token, address, 0, { overall_rating: 3 }));
    if (!first.ok) return void failures++;
    const second = await timed(saves, () => saveSurveyDraft(token, address, first.revision, { overall_rating: 4, ready_on_time: "yes" }));
    if (!second.ok) return void failures++;
    const key = `load-${i}-${Date.now()}`;
    const [a, b] = await Promise.all([timed(submits, () => submitSurvey(token, address, key, answers, second.revision)), timed(submits, () => submitSurvey(token, address, key, answers, second.revision))]);
    if (a.ok) acknowledged.add(a.responseId);
    if (b.ok) acknowledged.add(b.responseId);
    if (!a.ok && !b.ok) failures++;
  });
  const surveySeconds = (performance.now() - started) / 1000;

  check("Save p95 within 2 s", pct(saves, 95) <= 2000, `p50 ${pct(saves, 50).toFixed(0)} ms, p95 ${pct(saves, 95).toFixed(0)} ms, max ${pct(saves, 100).toFixed(0)} ms (${saves.length} saves)`);
  check("Submit p95 within 2 s", pct(submits, 95) <= 2000, `p50 ${pct(submits, 50).toFixed(0)} ms, p95 ${pct(submits, 95).toFixed(0)} ms, max ${pct(submits, 100).toFixed(0)} ms (${submits.length} submits incl. double clicks)`);
  check("Every customer submitted", failures === 0 && acknowledged.size === CUSTOMERS, `${acknowledged.size} of ${CUSTOMERS} acknowledged, ${failures} failed, in ${surveySeconds.toFixed(1)} s`);

  // 3. No lost or duplicated submission: one response and one original revision per invitation.
  const stored = await db
    .select({ invitationId: surveyResponse.invitationId, id: surveyResponse.id, revisions: sql<number>`(SELECT count(*)::int FROM response_revision rr WHERE rr.response_id = "survey_response"."id")` })
    .from(surveyResponse)
    .where(and(inArray(surveyResponse.invitationId, invitationIds), eq(surveyResponse.status, "submitted")));
  const lost = [...acknowledged].filter((id) => !stored.some((s) => s.id === id));
  check("No acknowledged submission lost", lost.length === 0, `${stored.length} stored, ${lost.length} missing`);
  check("No duplicate submission", stored.length === new Set(stored.map((s) => s.invitationId)).size && stored.every((s) => s.revisions === 1), `${stored.length} responses for ${new Set(stored.map((s) => s.invitationId)).size} invitations`);

  // 4. Results visible on the shop's dashboard at once, and nowhere else.
  const today = new Date().toISOString().slice(0, 10);
  const filters = parseFilters({}, today);
  const reads: number[] = [];
  let visible = 0;
  await pool(Array.from({ length: 20 }), 10, async () => {
    const rows = await timed(reads, () => db.transaction((tx) => cohortRows(tx, loadShop.id, filters, loadShop.timezone)));
    visible = Math.max(visible, rows.filter((r) => acknowledged.has(r.id)).length);
  });
  check("Dashboard read p95 within 5 s", pct(reads, 95) <= 5000, `p50 ${pct(reads, 50).toFixed(0)} ms, p95 ${pct(reads, 95).toFixed(0)} ms`);
  check("Every submission on the dashboard", visible === acknowledged.size, `${visible} of ${acknowledged.size} visible`);
  const others = await db.select({ id: shop.id, timezone: shop.timezone }).from(shop).where(sql`${shop.id} <> ${loadShop.id} AND ${shop.archivedAt} IS NULL`).limit(5);
  let leaked = 0;
  for (const o of others) leaked += (await db.transaction((tx) => cohortRows(tx, o.id, filters, o.timezone))).filter((r) => acknowledged.has(r.id)).length;
  check("No other shop sees these results", leaked === 0, `${leaked} rows seen by ${others.length} other shops`);

  // 5. Email: one invitation per imported visit, sent by the running worker within 5 minutes.
  if (EMAILS > 0) {
    const run = Date.now().toString(36);
    const csv = ["RO,First Name,Email,Delivered On", ...Array.from({ length: EMAILS }, (_, i) => `load-${run}-${i},Load,load${i}-${run}${DOMAIN},${today}`)].join("\n");
    const committedAt = Date.now();
    const batchInvitations = await db.transaction(async (tx) => {
      const batch = await createBatch(tx, system, { shopId: loadShop.id, kind: "visits", isTest: true, sourceSystem: "shop_documents", fileName: `load-${run}.csv`, content: csv });
      await commitBatch(tx, system, batch.id, batch.revision);
      return (await tx.select({ id: invitation.id }).from(invitation).where(sql`${invitation.importRowId} IN (SELECT id FROM import_row WHERE batch_id = ${batch.id})`)).map((r) => r.id);
    });
    let sent = 0;
    while (Date.now() - committedAt < 6 * 60 * 1000) {
      const [row] = await db.select({ n: count() }).from(emailIntent).where(and(inArray(emailIntent.invitationId, batchInvitations), inArray(emailIntent.state, ["accepted", "delivered"])));
      sent = row.n;
      if (sent >= EMAILS) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const waited = (Date.now() - committedAt) / 1000;
    check("Every email sent within 5 minutes", sent >= EMAILS && waited <= 300, `${sent} of ${EMAILS} accepted after ${waited.toFixed(0)} s (needs \`npm run worker\`)`);
    const dupes = await db
      .select({ invitationId: emailIntent.invitationId, n: count() })
      .from(emailIntent)
      .where(and(inArray(emailIntent.invitationId, batchInvitations), eq(emailIntent.kind, "initial")))
      .groupBy(emailIntent.invitationId)
      .having(sql`count(*) > 1 OR max(${emailIntent.attempts}) > 1`);
    check("No duplicate email", dupes.length === 0, `${dupes.length} invitations with more than one send`);
  }

  console.log("");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(36)} ${r.detail}`);
  await getPool().end();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await getPool().end();
  process.exit(1);
});
