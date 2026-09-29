/**
 * Launch readiness: every in-scope shop is on the manifest with what is
 * missing, internal test shops are listed apart, a PSG admin records a check
 * with a note and can withdraw it, and acceptance is refused while anything
 * else fails. Nothing here changes a shop's mode.
 * Requirements: SR-37; AT-37.
 *
 * Needs the dev server. Creates a shop that stays in Test mode.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createShop, ensureTestShop, gotoAndFind, signIn, TEST_SHOP, unique } from "./helpers";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

test("PSG sees every shop's launch checklist and records checks", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await ensureTestShop(page);
  const id = unique();
  const name = `E2E Readiness ${id}`;

  await createShop(page, { name, slug: `e2e-ready-${id}` });

  // The manifest lists the new shop with what is missing; test shops are apart.
  const row = page.getByRole("row", { name: new RegExp(name) });
  await gotoAndFind(page, "/psg/readiness", row);
  await expect(row).toContainText("Test");
  await expect(row).toContainText(/\d+ missing/);
  await expect(row).toContainText("Company mapping confirmed");
  await expect(page.getByText(/Not in scope \(internal test shops/)).toContainText(TEST_SHOP.name);
  await expect(page.getByRole("heading", { name: "Email sending, shared by every shop" })).toBeVisible();

  // The whole manifest exports as CSV to keep as launch evidence (WP-11).
  const exported = await page.request.get("/psg/readiness/export");
  expect(exported.status()).toBe(200);
  // The file starts with a byte-order mark so Excel reads it as UTF-8.
  const csv = (await exported.text()).replace(/^﻿/, "");
  expect(csv.split(/\r\n/)[0]).toBe('"Shop","Mode","First activated","Ready","Check","Status","Detail","Recorded by","Recorded at","Note"');
  expect(csv).toContain(`"${name}","Test","","no","Company mapping confirmed","fail"`);

  // Record one check on the shop's page, with a note.
  await row.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name: "Launch readiness" })).toBeVisible();
  const note = page.getByLabel("What you checked for Company mapping confirmed");
  await expect(async () => {
    await note.fill("Matches FileMaker company 1042");
    await expect(page.getByRole("button", { name: "Record check: Company mapping confirmed" })).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("button", { name: "Record check: Company mapping confirmed" }).click();
  await expect(page.getByText(/Confirmed by .+: “Matches FileMaker company 1042”/)).toBeVisible();

  // Acceptance is refused while anything else fails, and says what.
  await page.getByLabel("What you checked for PSG accepted for launch").fill("Everything looks fine");
  await page.getByRole("button", { name: "Record check: PSG accepted for launch" }).click();
  await expect(page.getByText(/^Accept only when everything else passes\. Still missing: Verified survey version/)).toBeVisible();

  // Withdraw the check again; the mode never changed.
  await page.getByRole("button", { name: "Withdraw check: Company mapping confirmed" }).click();
  await expect(page.getByLabel("What you checked for Company mapping confirmed")).toBeVisible();
  await expect(page.getByText("Current mode").locator("..")).toContainText("Test");
});
