/**
 * Phase 2 shop setup: PSG opens a shop profile, sees why it cannot go Live
 * yet, sets the cutoff, version, timing and branding, and sees the change in
 * the history. Also manages the internal test recipient list.
 * Requirements: SR-02, SR-03, SR-04, SR-05, AT-14.
 *
 * It never publishes verified content (G-01), so it stops before Live.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createShop, fillUntilEnabled, findOnPages, signIn, unique } from "./helpers";

test.skip(!adminCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run browser tests");

test("PSG configures a shop and cannot go Live without verified content", async ({ page }) => {
  await signIn(page);

  const name = `E2E Settings ${unique()}`;
  await createShop(page, { name });
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // A new shop starts in Test mode and lists what is missing before Live.
  await expect(page.locator("dd", { hasText: /^Test$/ })).toBeVisible();
  await page.getByRole("button", { name: "Switch to Live" }).click();
  await expect(page.getByText("Set the delivery cutoff date first.")).toBeVisible();
  await expect(page.getByText("Assign a published survey version first.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Confirm: / })).toHaveCount(0);

  // Configure: cutoff, a TEST version, timing, recipients and branding.
  await page.getByRole("button", { name: "Use today" }).click();
  const versions = page.getByLabel("Survey version for new invitations");
  const testOption = versions.locator("option", { hasText: "(TEST)" }).first();
  await versions.selectOption((await testOption.getAttribute("value")) ?? "");
  await expect(page.getByText("This is a TEST version.")).toBeVisible();
  await page.getByLabel("Reminder delay (days)").fill("5");
  await page.getByLabel("Negative alert recipients").fill("owner@shop.example");
  await page.getByLabel("Brand colour", { exact: true }).fill("#7a1f2b");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  // History shows what changed.
  const history = page.getByRole("region", { name: "Activation and settings history" });
  await expect(history.getByText("Reminder delay (days): 7 → 5")).toBeVisible();
  await expect(history.getByText("Brand colour: not set → #7a1f2b")).toBeVisible();

  // A TEST version never reaches Live customers (AT-14).
  await page.getByRole("button", { name: "Switch to Live" }).click();
  await expect(page.getByText(/assigned version is a TEST version/)).toBeVisible();
  // The first Live also needs the whole launch checklist, acceptance last (SR-37).
  await expect(page.getByText("Launch checklist: Internal test passed")).toBeVisible();
  await expect(page.getByText("Launch checklist: PSG accepted for launch")).toBeVisible();

  // Invalid input is explained next to the field and nothing is saved.
  await page.getByLabel("Approved logo link").fill("http://insecure.example/logo.png");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Use an https:// link")).toBeVisible();
});

test("PSG manages the internal test recipient list", async ({ page }) => {
  await signIn(page);
  const domain = `@e2e-${unique()}.example`;
  await page.goto("/psg/test-recipients");
  await fillUntilEnabled(page, "Email address or @domain", domain, "Add to list");
  await page.getByLabel("Note (optional)").fill("E2E");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByText(`Added ${domain} to the list.`)).toBeVisible();

  await fillUntilEnabled(page, "Email address or @domain", domain, "Add to list");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByText("That entry is already on the list.")).toBeVisible();

  // The list is paged: find the entry's page, then remove it there.
  expect(await findOnPages(page, page.getByRole("cell", { name: domain, exact: true }))).toBe(true);
  await page.getByRole("button", { name: `Remove ${domain}` }).click();
  await expect(page.getByRole("cell", { name: domain, exact: true })).toHaveCount(0);
});
