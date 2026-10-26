import { expect, type Browser, type Page } from "@playwright/test";
import { withDb } from "./db";
import { openShop, signInAs, TEST_SHOP, unique } from "./helpers";

/**
 * PSG adds a shop user to the internal test shop; the user sets a password
 * from the emailed link (read from the database, as email is only logged
 * locally) and signs in. Returns the shop id and the signed-in shop page.
 */
export async function createShopUser(page: Page, browser: Browser, shopName = TEST_SHOP.name): Promise<{ shopId: string; shopPage: Page; close: () => Promise<void> }> {
  const id = unique();
  const email = `shop-user-${id}@e2e.example`;
  const password = `Shop-user-${id}-pass`;
  await openShop(page, shopName);
  await page.waitForURL(/\/psg\/shops\/[0-9a-f-]{36}$/);
  const shopId = page.url().split("/psg/shops/")[1];
  await page.getByLabel("Name", { exact: true }).fill("E2E Shop User");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Add shop user" }).click();
  await expect(page.getByText(`${email} will get an email to set a password`)).toBeVisible();

  const token = await withDb(async (db) => {
    const user = (await db.query(`SELECT id FROM "user" WHERE email = $1`, [email])).rows[0];
    const reset = (await db.query(`SELECT identifier FROM verification WHERE value = $1 AND identifier LIKE 'reset-password:%' ORDER BY created_at DESC LIMIT 1`, [user.id])).rows[0];
    return String(reset.identifier).replace("reset-password:", "");
  });
  const context = await browser.newContext();
  const shopPage = await context.newPage();
  await shopPage.goto(`/reset-password?token=${token}`);
  await shopPage.getByLabel("New password", { exact: true }).fill(password);
  await shopPage.getByLabel("Confirm new password").fill(password);
  await shopPage.getByRole("button", { name: "Set new password" }).click();
  await expect(shopPage.getByText("Your password was changed")).toBeVisible();
  await signInAs(shopPage, email, password, new RegExp(`/shop/${shopId}`));
  return { shopId, shopPage, close: () => context.close() };
}

/** Fill the demo survey on the public form with low ratings (fires every demo alert and the suppression rule). */
export async function submitNegativePublic(phone: Page, name: string, repairOrder: string) {
  await phone.goto(`/survey/shop/${TEST_SHOP.slug}`);
  await phone.getByLabel("Your name").fill(name);
  await phone.getByLabel("Repair order or claim number").fill(repairOrder);
  await phone.locator('input[name="public-overall_rating"][value="1"]').check({ force: true });
  await phone.getByLabel("No", { exact: true }).first().check();
  for (const row of ["Communication during the repair", "Quality of the repair", "Cleanliness of the vehicle at pickup"]) {
    await phone.getByRole("group", { name: row }).getByLabel("Poor").check();
  }
  await phone.locator('input[name="public-recommend_score"][value="2"]').check({ force: true });
  await phone.getByRole("button", { name: "Send feedback" }).click();
  await expect(phone.getByRole("heading", { name: "Thank you for your feedback" })).toBeVisible();
}
