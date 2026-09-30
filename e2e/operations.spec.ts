/**
 * Operator queues: a held import shows with its reason and source row, a
 * PSG operator takes ownership, the owner filters work, and the change is in
 * the item's history. Test data stays hidden unless asked for. The page fits
 * a phone screen.
 * Requirements: SR-38; AT-38 (retry and original error are covered in the DB tests).
 *
 * Needs the dev server; only uses the internal test shop.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, ensureTestShop, ensureTestShopVersion, findOnPages, signIn, unique, uploadForTestShop } from "./helpers";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

test("operators see held work with a reason and can take ownership", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await ensureTestShop(page);
  await ensureTestShopVersion(page);
  const id = unique();
  const file = `ops-${id}.csv`;

  // A visit with neither email nor delivery date is held at import.
  await uploadForTestShop(page, file, ["RO #,First Name,Email,Delivered On", `${id}-H,Harper,,`].join("\n"));
  await page.getByLabel("I reviewed the preview for this shop.").check();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Committed", { exact: true })).toBeVisible();

  // Test data is hidden by default, so real work is never buried under it.
  await page.goto("/psg/operations?kind=held_import");
  await expect(page.getByRole("heading", { name: "Operator queues" })).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: `Visit ${id}-H` });
  await expect(item).toHaveCount(0);
  await page.getByRole("switch", { name: "Hide test data" }).click();
  await page.waitForURL(/test=1/);
  // Oldest items come first, so a new one is on the last page.
  expect(await findOnPages(page, item)).toBe(true);
  await expect(item).toBeVisible();
  await expect(item).toContainText("Delivery date needed");
  await expect(item).toContainText("Email needed");
  await expect(item).toContainText(`Imported from ${file}, row 1`);
  await expect(item.getByText("Test", { exact: true })).toBeVisible();
  await expect(item.getByRole("link", { name: "Open in Invitations" })).toHaveAttribute("href", /\/psg\/invitations\?shop=.+&view=held/);

  // Take ownership; the history records it.
  const title = `Visit ${id}-H · Harper`;
  const owner = item.getByLabel(`Owner of ${title}`);
  const takeIt = item.getByRole("button", { name: `Take ownership of ${title}` });
  await expect(owner).toHaveValue("");
  // Wait for hydration before clicking once; a second click would carry a stale revision.
  await expect(owner).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await takeIt.click();
  await expect(owner).not.toHaveValue("");
  await item.getByText(/^History \(/).click();
  await expect(item.getByText("Owner assigned")).toBeVisible();

  // Owner filters.
  await page.getByRole("link", { name: "Mine", exact: true }).click();
  await page.waitForURL(/owner=mine/);
  await expect(item).toBeVisible();
  await page.getByRole("link", { name: "No owner", exact: true }).click();
  await page.waitForURL(/owner=unassigned/);
  await expect(item).toHaveCount(0);

  // Clear the owner again with the keyboard-reachable select.
  await page.getByRole("link", { name: "Everyone", exact: true }).click();
  await page.waitForURL((url) => !url.search.includes("owner="));
  expect(await findOnPages(page, item)).toBe(true);
  await owner.selectOption("");
  await expect(takeIt).toBeVisible();

  // Overview shows the queue summary.
  await page.goto("/psg");
  await expect(page.getByRole("link", { name: /Operator items waiting/ })).toBeVisible();
});

test("the operator queue page fits a phone screen", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await context.newPage();
  await signIn(phone);
  await phone.goto("/psg/operations?test=1");
  await expect(phone.getByRole("heading", { name: "Operator queues" })).toBeVisible();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});
