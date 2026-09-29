/**
 * Legacy unresolved cases: PSG imports the legacy case list, sees open and
 * closed cases apart, takes an open one over into Hub with a recorded
 * handoff, follows it up and resolves it. Re-importing the same file changes
 * nothing Hub now owns and creates no second case.
 * Requirements: SR-46; AT-46.
 *
 * Needs the dev server. Creates a shop that stays in Test mode; legacy cases
 * are production evidence, so they are imported as production data there.
 */
import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, createShop, gotoAndFind, signIn, unique } from "./helpers";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

async function importCases(page: Page, shopName: string, file: string, content: string) {
  await page.goto("/psg/imports");
  await page.getByLabel("Shop", { exact: true }).selectOption({ label: shopName });
  await page.getByLabel("What is in the file").selectOption("legacy_cases");
  await page.getByLabel("CSV file").setInputFiles({ name: file, mimeType: "text/csv", buffer: Buffer.from(content) });
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.waitForURL(/\/psg\/imports\/[0-9a-f-]{36}$/);
}

test("PSG takes a legacy case over into Hub, and re-importing never duplicates it", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);
  const id = unique();
  const shopName = `E2E Legacy ${id}`;
  await createShop(page, { name: shopName, slug: `e2e-legacy-${id}` });

  const csv = ["Case ID,Status,Opened,Issue,Owner,Customer", `${id}-A,Open,2026-06-01,Paint does not match,Dana,Jo Smith`, `${id}-B,Closed,2026-05-01,Car was late,Dana,Al Lee`].join("\n");

  // 1. The preview is a dry run that shows what happens to each row.
  await importCases(page, shopName, `cases-${id}.csv`, csv);
  await expect(page.getByText("Closed in legacy: kept for reference only")).toBeVisible();
  await page.getByLabel("I reviewed the preview for this shop.").check();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Committed", { exact: true })).toBeVisible();

  // 2. Open and closed cases are apart; the closed one is reference only.
  await gotoAndFind(page, "/psg/legacy-cases?view=reference", page.getByRole("link", { name: `${id}-B` }));
  await gotoAndFind(page, "/psg/legacy-cases", page.getByRole("link", { name: `${id}-A` }));
  await page.getByRole("link", { name: `${id}-A` }).click();
  await expect(page.getByRole("heading", { name: `Legacy case ${id}-A` })).toBeVisible();
  await expect(page.getByText("Still with the legacy owner")).toBeVisible();

  // 3. Handoff needs the confirmation and a note.
  const takeOver = page.getByRole("button", { name: "Take over in Hub" });
  await expect(takeOver).toBeDisabled();
  await expect(async () => {
    await page.getByLabel("Dana has stopped following this case up in the legacy system.").check();
    await page.getByLabel("Who you agreed the handoff with, and when").fill("Agreed with Dana on the phone today");
    await expect(takeOver).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await takeOver.click();
  await expect(page.getByText(/Taken over by .+: “Agreed with Dana on the phone today”/)).toBeVisible();

  // 4. Follow up and resolve in Hub.
  await page.getByLabel("Add a follow-up note").fill("Called Jo, booked a repaint");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Called Jo, booked a repaint")).toBeVisible();
  await page.getByLabel("Outcome").selectOption("resolved_with_customer");
  await page.getByLabel("How it was resolved").fill("Door repainted, customer happy");
  await page.getByRole("button", { name: "Confirm resolution" }).click();
  await expect(page.getByText(/Resolved by .+: Resolved with the customer/)).toBeVisible();

  // 5. Re-importing the same cases leaves Hub's case alone and adds none.
  await importCases(page, shopName, `cases-${id}-again.csv`, csv.replace("Paint does not match", "Changed later in the legacy system"));
  await expect(page.getByText("Hub already follows this case up: left unchanged")).toBeVisible();
  await page.getByLabel("I reviewed the preview for this shop.").check();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Committed", { exact: true })).toBeVisible();
  await gotoAndFind(page, "/psg/legacy-cases?view=resolved", page.getByRole("link", { name: `${id}-A` }));
  await expect(page.getByRole("link", { name: `${id}-A` })).toHaveCount(1);
  await page.getByRole("link", { name: `${id}-A` }).click();
  // The legacy record kept its original text: the later file did not overwrite it.
  const record = page.getByRole("region", { name: "As recorded in the legacy system" });
  await expect(page.getByRole("heading", { name: `Legacy case ${id}-A` })).toBeVisible();
  await expect(record).toContainText("Paint does not match");
  await expect(record).not.toContainText("Changed later in the legacy system");
});
