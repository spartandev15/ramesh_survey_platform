/**
 * Phase 2 email: the running worker sends a test invitation once; an
 * expired link offers renewal without revealing any address; the renewal
 * goes to the address on record; the opt-out page changes nothing until the
 * customer confirms, and a forged link is refused.
 * Requirements: SR-21, SR-22, SR-23, SR-25; AT-22, AT-23, AT-25.
 *
 * Needs the dev server and `npm run worker` (EMAIL_PROVIDER=log) running,
 * and only uses allowlisted internal test addresses.
 */
import { expect, test } from "@playwright/test";
import { hashToken, optOutToken, waitForIntent, withDb } from "./db";
import { adminCredentials, allowTestDomain, ensureTestShop, ensureTestShopVersion, findOnPages, respondentPhone, signIn, TEST_SHOP, unique, uploadForTestShop } from "./helpers";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

const INTENT_SQL = `SELECT e.state FROM email_intent e JOIN invitation i ON i.id = e.invitation_id JOIN repair_visit v ON v.id = i.visit_id WHERE v.source_visit_key = $1 AND e.kind = $2`;

test("the worker sends, renews and honours opt-out for test invitations", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await signIn(page);
  await ensureTestShop(page);
  await ensureTestShopVersion(page);
  const id = unique();
  const domain = `@mail-${id}.example`;
  await allowTestDomain(page, domain);

  await uploadForTestShop(page, `mail-${id}.csv`, ["RO #,First Name,Email,Delivered On", `${id}-A,Avery,avery${domain},2026-10-02`, `${id}-B,Blake,,2026-10-02`].join("\n"));
  await page.getByLabel("I reviewed the preview for this shop.").check();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Committed", { exact: true })).toBeVisible();

  // 1. The worker sends the invitation exactly once (AT-23).
  await withDb(async (db) => {
    expect(await waitForIntent(db, INTENT_SQL, [`${id}-A`, "initial"], ["accepted", "delivered"])).toMatch(/accepted|delivered/);
    const { rows } = await db.query(`SELECT count(*)::int AS n, max(attempts) AS attempts FROM email_intent e JOIN invitation i ON i.id = e.invitation_id JOIN repair_visit v ON v.id = i.visit_id WHERE v.source_visit_key = $1`, [`${id}-A`]);
    expect(rows[0]).toEqual({ n: 1, attempts: 1 });
  });
  await page.goto("/psg/invitations");
  await page.getByLabel("Shop", { exact: true }).selectOption({ label: TEST_SHOP.name });
  await page.waitForURL(/shop=/);
  await page.getByRole("link", { name: /^Sent/ }).click();
  await page.waitForURL(/view=sent/);
  expect(await findOnPages(page, page.getByRole("row", { name: new RegExp(`${id}-A`) }))).toBe(true);
  await expect(page.getByRole("row", { name: new RegExp(`${id}-A`) })).toContainText("Email accepted");

  // 2. Blake has no email: issue a printable link, then add an address (sends nothing).
  await page.getByRole("link", { name: /^Held/ }).click();
  const blake = page.getByRole("row", { name: new RegExp(`${id}-B`) });
  await blake.getByRole("button", { name: "Printable link" }).click();
  const url = (await page.locator("p.font-mono.break-all").textContent())!.trim();
  const token = url.split("/survey/")[1];
  await blake.getByRole("button", { name: "Fix details" }).click();
  await page.getByLabel("Email", { exact: true }).fill(`blake${domain}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForLoadState("networkidle");

  // 3. Expire the printed link (move its clock), then ask for a new one (AT-22).
  await withDb((db) => db.query(`UPDATE access_token SET issued_at = now() - interval '100 days', expires_at = now() - interval '1 day' WHERE token_hash = $1`, [hashToken(token)]));
  const phone = await respondentPhone(browser);
  await phone.goto(`/survey/${token}`);
  await expect(phone.getByRole("heading", { name: "This survey link has expired" })).toBeVisible();
  await phone.getByRole("button", { name: "Email me a new link" }).click();
  const generic = "If we can renew this survey, a new link will arrive at the email address we have on file";
  await expect(phone.getByText(generic)).toBeVisible();
  await expect(phone.locator("body")).not.toContainText(domain);

  await withDb(async (db) => {
    expect(await waitForIntent(db, INTENT_SQL, [`${id}-B`, "renewal"], ["accepted", "delivered"])).toMatch(/accepted|delivered/);
    const { rows } = await db.query(`SELECT revoked_at FROM access_token WHERE token_hash = $1`, [hashToken(token)]);
    expect(rows[0].revoked_at).not.toBeNull();
  });
  // The old link no longer opens the survey.
  await phone.reload();
  await expect(phone.getByRole("heading", { name: "This survey link is not valid" })).toBeVisible();

  // 4. Opt-out: opening the page changes nothing; confirming does; a forged link is refused (AT-25).
  const invitationId = await withDb(async (db) => (await db.query(`SELECT i.id FROM invitation i JOIN repair_visit v ON v.id = i.visit_id WHERE v.source_visit_key = $1`, [`${id}-A`])).rows[0].id as string);
  const optOutCount = () => withDb(async (db) => (await db.query(`SELECT count(*)::int AS n FROM shop_opt_out WHERE email_normalized = $1`, [`avery${domain}`])).rows[0].n as number);
  await phone.goto(`/survey/opt-out/${optOutToken(invitationId)}`);
  await expect(phone.getByRole("heading", { name: `Stop survey emails from ${TEST_SHOP.name}?` })).toBeVisible();
  expect(await optOutCount()).toBe(0);
  await phone.getByRole("button", { name: "Yes, stop survey emails" }).click();
  await expect(phone.getByRole("heading", { name: "You are opted out" })).toBeVisible();
  expect(await optOutCount()).toBe(1);

  await phone.goto(`/survey/opt-out/${optOutToken(invitationId).slice(0, -2)}xx`);
  await expect(phone.getByRole("heading", { name: "This link is not valid" })).toBeVisible();

  // 5. PSG email review page is reachable.
  await page.goto("/psg/email");
  await expect(page.getByRole("heading", { name: "Email review" })).toBeVisible();
});
