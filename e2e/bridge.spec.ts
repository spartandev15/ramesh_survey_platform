/**
 * FileMaker bridge page: writes stay off, saying why, while there is no
 * FileMaker connection; the go-live checks are recorded with a note, and
 * the final switch refuses until every other check is recorded. Leaves the
 * checks as it found them. Write, replay and conflict behaviour is covered
 * by the database tests with an in-memory FileMaker.
 * Requirements: SR-41, SR-42, SR-43, SR-47 (signing a retirement is covered by the database tests).
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, signIn, unique } from "./helpers";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

test("the bridge stays off until it is connected and every check is recorded", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/psg/bridge");
  await expect(page.getByRole("heading", { name: "Writes to FileMaker: Off" })).toBeVisible();
  await expect(page.getByText(/No FileMaker connection is set up yet/)).toBeVisible();
  await expect(page.getByText("Confirmed by read-back")).toBeVisible();

  // The final switch refuses while other checks are missing.
  const switchNote = page.getByLabel("What was checked, and with whom for Writes switched on");
  await expect(async () => {
    await switchNote.fill("Switch it on");
    await expect(page.getByRole("button", { name: "Record check: Writes switched on" })).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("button", { name: "Record check: Writes switched on" }).click();
  await expect(page.getByText(/^Record these first: Field map approved/)).toBeVisible();

  // Record one check with a note, then withdraw it again.
  await page.getByLabel("What was checked, and with whom for Field map approved").fill("Draft map reviewed with the FileMaker owner");
  await page.getByRole("button", { name: "Record check: Field map approved" }).click();
  await expect(page.getByText(/Recorded by .+: “Draft map reviewed with the FileMaker owner”/)).toBeVisible();
  await page.getByRole("button", { name: "Withdraw check: Field map approved" }).click();
  await expect(page.getByRole("button", { name: "Record check: Field map approved" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Writes to FileMaker: Off" })).toBeVisible();
});

test("a FileMaker dependency blocks retirement until it is dealt with (SR-47)", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/psg/bridge");
  const name = `E2E report ${unique()}`;
  await expect(async () => {
    await page.getByLabel("FileMaker report, mail run or screen").fill(name);
    await page.getByLabel("What it uses from the bridge").fill("Survey results");
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`Still in use: ${name}.`)).toBeVisible();

  // Dependencies are evidence: they are marked no longer needed, never deleted.
  await page.getByLabel(`State of ${name}`, { exact: true }).selectOption("retired");
  await page.getByLabel(`Why ${name} is no longer needed`).fill("Test report only, never used by the shop");
  await page.getByRole("button", { name: `Save state of ${name}` }).click();
  await expect(page.getByText(`Still in use: ${name}.`)).toHaveCount(0);
  // Earlier runs leave their own retired dependencies (never deleted), so look at this one only.
  await expect(page.getByRole("listitem").filter({ hasText: name })).toContainText("No longer needed: Test report only, never used by the shop");
});
