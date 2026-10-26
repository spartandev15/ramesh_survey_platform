/**
 * The top bar works on every page: the search finds pages, shops and surveys
 * and hands the words to the searchable lists; the bell lists waiting work
 * with links, and its count matches the list.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, ensureTestShop, signIn, TEST_SHOP } from "./helpers";

test.skip(!adminCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run browser tests");

test("top bar search finds pages and shops, and the bell lists waiting work", async ({ page }) => {
  await signIn(page);
  await ensureTestShop(page);

  // Search: a page by name, a shop by name, and the words passed on to a list.
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("alert");
  await search.press("Enter");
  await page.waitForURL(/\/psg\/search\?q=alert/);
  await expect(page.getByRole("region", { name: "Pages" }).getByRole("link", { name: /Alert review/ })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill(TEST_SHOP.name);
  await page.getByRole("searchbox", { name: "Search", exact: true }).press("Enter");
  await expect(page.getByRole("region", { name: "Shops" }).getByRole("link", { name: TEST_SHOP.name })).toBeVisible();
  await page.getByRole("region", { name: /Look for/ }).getByRole("link", { name: "Responses" }).click();
  await expect(page).toHaveURL(/\/psg\/responses\?q=/);

  // Bell: the badge count is the sum of the listed items, and each item opens its page.
  const bell = page.getByRole("button", { name: /^Notifications/ });
  await bell.click();
  // The list loads after each page change ("Checking…"); read the counts only once it has arrived.
  await expect(page.getByText("Checking…")).toHaveCount(0);
  const name = (await bell.getAttribute("aria-label")) ?? "";
  const items = page.locator("header li a");
  const counts = await items.locator("span").allTextContents();
  const total = counts.reduce((n, c) => n + Number(c), 0);
  if (total === 0) await expect(page.getByText("Nothing is waiting for you.")).toBeVisible();
  else {
    expect(name).toBe(`Notifications, ${total} waiting`);
    const href = await items.first().getAttribute("href");
    await items.first().click();
    await expect(page).toHaveURL(new RegExp(href!.replace(/[?]/g, "\?")));
  }
});
