/**
 * The top bar works on every page: the search finds pages, shops and surveys
 * and hands the words to the searchable lists; the bell lists waiting work
 * with links, and its count matches the list. A click inside a page shows the
 * loading bar while the next list loads.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, ensureTestShop, pageLoaded, signIn, TEST_SHOP } from "./helpers";

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

test("a click on a link inside a page shows the loading bar until the list arrives", async ({ page }) => {
  await signIn(page);
  // Hold the filtered list's data (prefetch and click alike), so the wait is long enough to see.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/psg\/instruments\?(.*&)?status=draft/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/psg/instruments");
  await pageLoaded(page);

  const draft = page.getByRole("navigation", { name: "Quick filters" }).getByRole("link", { name: /^Draft/ });
  await draft.click();
  // The top bar (src/components/loading.tsx NavProgress) and the chip's own spinner.
  await expect(page.locator(".nav-progress")).toBeVisible();
  await expect(draft.locator("svg.animate-spin")).toBeVisible();
  await page.screenshot({ path: "test-results/loading-bar.png" });
  release();
  await expect(page.locator(".nav-progress")).toHaveCount(0);
  await expect(page).toHaveURL(/status=draft/);
  await pageLoaded(page);
  await expect(draft).toHaveAttribute("aria-current", "true");
});
