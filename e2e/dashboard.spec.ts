/**
 * Phase 2 dashboard: PSG adds a shop user, who sets a password from the
 * emailed link and sees only their own shop. A new public response appears
 * at once as pending match without changing scores, and the export matches
 * the screen. Another shop's pages and export are not found.
 * Requirements: SR-01, SR-27, SR-28, SR-31; AT-01, AT-27, AT-28, AT-31, AT-40.
 */
import { expect, test } from "@playwright/test";
import { withDb } from "./db";
import { adminCredentials, ensureTestShop, openShop, respondentPhone, signIn, signInAs, TEST_SHOP, unique } from "./helpers";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

test("a shop user sees their own results immediately and nothing from other shops", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await ensureTestShop(page);
  const id = unique();
  const email = `shop-user-${id}@e2e.example`;
  const password = `Shop-user-${id}-pass`;

  // 1. PSG adds a shop user to the internal test shop.
  await openShop(page, TEST_SHOP.name);
  await page.waitForURL(/\/psg\/shops\/[0-9a-f-]{36}$/);
  const shopId = page.url().split("/psg/shops/")[1];
  await page.getByLabel("Name", { exact: true }).fill("E2E Shop User");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Add shop user" }).click();
  await expect(page.getByText(`${email} will get an email to set a password`)).toBeVisible();

  // 2. They set a password from the emailed link (read from the database, as the email is only logged locally).
  const { token, otherShopId } = await withDb(async (db) => {
    const user = (await db.query(`SELECT id FROM "user" WHERE email = $1`, [email])).rows[0];
    const reset = (await db.query(`SELECT identifier FROM verification WHERE value = $1 AND identifier LIKE 'reset-password:%' ORDER BY created_at DESC LIMIT 1`, [user.id])).rows[0];
    const other = (await db.query(`SELECT id FROM shop WHERE id <> $1 AND archived_at IS NULL LIMIT 1`, [shopId])).rows[0];
    return { token: String(reset.identifier).replace("reset-password:", ""), otherShopId: other.id as string };
  });
  const shopContext = await browser.newContext();
  const shopPage = await shopContext.newPage();
  await shopPage.goto(`/reset-password?token=${token}`);
  await shopPage.getByLabel("New password", { exact: true }).fill(password);
  await shopPage.getByLabel("Confirm new password").fill(password);
  await shopPage.getByRole("button", { name: "Set new password" }).click();
  await expect(shopPage.getByText("Your password was changed")).toBeVisible();
  await signInAs(shopPage, email, password, new RegExp(`/shop/${shopId}`));
  await expect(shopPage.getByRole("heading", { name: "Survey dashboard" })).toBeVisible();

  // One stat card: the direct child of the counts section whose label matches exactly.
  const stat = (label: string) =>
    shopPage
      .getByRole("region", { name: "Response counts" })
      .locator(":scope > div", { has: shopPage.getByText(label, { exact: true }) })
      .locator("p.text-2xl");
  const submittedBefore = Number(await stat("Submitted").textContent());
  const countedBefore = Number(await stat("Counted in scores").textContent());

  // 3. A customer submits the public form; the result is visible on refresh, pending match (AT-27, AT-28).
  const phone = await respondentPhone(browser);
  await phone.goto(`/survey/shop/${TEST_SHOP.slug}`);
  await phone.getByLabel("Your name").fill(`Dash Customer ${id}`);
  await phone.locator('input[name="public-overall_rating"][value="1"]').check({ force: true });
  await phone.getByLabel("No", { exact: true }).first().check();
  for (const row of ["Communication during the repair", "Quality of the repair", "Cleanliness of the vehicle at pickup"]) {
    await phone.getByRole("group", { name: row }).getByLabel("Poor").check();
  }
  await phone.locator('input[name="public-recommend_score"][value="2"]').check({ force: true });
  await phone.getByRole("button", { name: "Send feedback" }).click();
  await expect(phone.getByRole("heading", { name: "Thank you for your feedback" })).toBeVisible();

  await shopPage.reload();
  await expect(stat("Submitted")).toHaveText(String(submittedBefore + 1));
  await expect(stat("Counted in scores")).toHaveText(String(countedBefore));
  const newest = shopPage.getByRole("region", { name: "Responses", exact: true }).getByRole("row").nth(1);
  await expect(newest).toContainText("Pending customer match");
  await expect(newest).toContainText("Public form");

  // The shop's detail page shows answers but not what the respondent typed about themselves.
  await newest.getByRole("link").click();
  await expect(shopPage.getByRole("heading", { name: "Customer response" })).toBeVisible();
  await expect(shopPage.getByText("PSG is connecting this response")).toBeVisible();
  await expect(shopPage.locator("body")).not.toContainText(`Dash Customer ${id}`);

  // 4. The export is the same cohort as the screen, and formula-safe (AT-31, AT-40).
  await shopPage.goto(`/shop/${shopId}`);
  const exportHref = await shopPage.getByRole("link", { name: "Export CSV" }).getAttribute("href");
  const csv = await (await shopPage.request.get(exportHref!)).text();
  const lines = csv.trim().split(/\r\n/);
  expect(lines[0]).toContain('"response_id"');
  // Every row says which date basis and filters it came from (SR-31).
  expect(lines[0]).toContain('"report_date_basis","report_from","report_to","report_source","report_version"');
  if (lines.length > 1) expect(lines[1]).toContain('"Date submitted"');
  expect(lines.length - 1).toBe(submittedBefore + 1);
  expect(lines.filter((l) => l.includes('"Counted","yes"')).length).toBe(countedBefore);

  // 5. Another shop, the PSG workspace and another shop's export are not available (AT-01).
  await shopPage.goto(`/shop/${otherShopId}`);
  await expect(shopPage.getByText(/not found|could not be found/i).first()).toBeVisible();
  const otherExport = await shopPage.request.get(`/api/survey-results/export?shop=${otherShopId}`);
  expect(otherExport.status()).toBe(404);
  const psg = await shopPage.goto("/psg");
  expect(psg?.status()).toBe(404);
  await expect(shopPage.getByText("PSG Workspace")).toHaveCount(0);
  await shopContext.close();
});
