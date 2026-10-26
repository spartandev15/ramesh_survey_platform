/**
 * The shop's public link and QR code open in popups, the QR code downloads,
 * and a shop can be deleted after a Yes/No question. Deleting keeps every
 * record (PDF 09): the shop only leaves the lists and screens.
 * Requirements: SR-13, SR-39.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createShop, findOnPages, signIn, unique } from "./helpers";
import { createShopUser } from "./shop-user";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

test("PSG sees a shop's public link and QR code in popups, then deletes the shop after confirming", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const id = unique();
  const name = `E2E Delete ${id}`;
  await createShop(page, { name, slug: `e2e-delete-${id}` });
  const shopUrl = page.url();
  // A user of this shop, to check that deleting the shop closes it to them.
  const shopUser = await createShopUser(page, browser, name);
  await shopUser.shopPage.goto(`/shop/${shopUser.shopId}/cases`);
  await expect(shopUser.shopPage.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto(shopUrl);

  // Public link popup, with the full address.
  await page.getByRole("button", { name: "Link", exact: true }).click();
  const linkDialog = page.getByRole("dialog", { name: `Public survey link: ${name}` });
  await expect(linkDialog.getByText(new RegExp(`/survey/shop/e2e-delete-${id}$`))).toBeVisible();
  await linkDialog.getByRole("button", { name: "Close" }).click();
  await expect(linkDialog).toBeHidden();

  // QR popup: the image loads and the download is a real PNG file.
  await page.getByRole("button", { name: "QR code", exact: true }).click();
  const qrDialog = page.getByRole("dialog", { name: `QR code: ${name}` });
  await expect(qrDialog.getByRole("img")).toHaveJSProperty("complete", true);
  expect(await qrDialog.getByRole("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const [download] = await Promise.all([page.waitForEvent("download"), qrDialog.getByRole("link", { name: "Download PNG" }).click()]);
  expect(download.suggestedFilename()).toBe(`e2e-delete-${id}-survey-qr.png`);
  await page.keyboard.press("Escape");
  await expect(qrDialog).toBeHidden();

  // Search finds it; the export has exactly the shops in view, as safe CSV.
  await page.goto("/psg/shops");
  await page.getByRole("searchbox", { name: "Search shops" }).fill(`delete ${id}`);
  await page.getByLabel("Type").selectOption("production");
  // No button: the list follows the typing and the filter change on its own.
  await expect(page).toHaveURL(new RegExp(`q=delete\\+${id}&type=production`));
  await expect(page.getByText("1 of ")).toBeVisible();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
  const text = await (await csv.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text.split("\r\n").filter(Boolean)).toHaveLength(2);
  expect(text).toContain(`"${name}"`);
  await page.getByRole("link", { name, exact: true }).click();
  await page.waitForURL(shopUrl);

  // "No" keeps the shop.
  await page.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this shop?" });
  await expect(confirm.getByText(name)).toBeVisible();
  await confirm.getByRole("button", { name: "No, keep it" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // "Yes" deletes it: gone from the list, its page and its QR code.
  await page.getByRole("button", { name: "Delete" }).click();
  await confirm.getByRole("button", { name: "Yes, delete" }).click();
  await page.waitForURL(/\/psg\/shops$/);
  expect(await findOnPages(page, page.getByRole("link", { name, exact: true }))).toBe(false);
  // The page streams behind its loading placeholder, so the status is already sent: the not-found page shows instead.
  await page.goto(shopUrl);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  expect((await page.request.get(`${shopUrl}/qr`)).status()).toBe(404);
  // Its users lose the shop too: dashboard, follow-up cases and notifications.
  for (const path of [`/shop/${shopUser.shopId}`, `/shop/${shopUser.shopId}/cases`]) {
    await shopUser.shopPage.goto(path);
    await expect(shopUser.shopPage.getByText(/not found|could not be found/i).first()).toBeVisible();
  }
  expect((await shopUser.shopPage.request.get(`/api/notifications?shop=${shopUser.shopId}`)).ok()).toBe(false);
  await shopUser.close();
});
