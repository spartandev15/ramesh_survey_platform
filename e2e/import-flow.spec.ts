/**
 * Phase 2 import: PSG uploads a synthetic batch for the internal test shop,
 * reviews the preview, commits, and works the invitation queue. Only test
 * data and allowlisted internal addresses are used (SR-37).
 * Requirements: SR-03, SR-06, SR-07, SR-09, SR-10, SR-11; AT-03, AT-06, AT-09, AT-10.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, allowTestDomain, ensureTestShop, ensureTestShopVersion, signIn, TEST_SHOP, unique, uploadForTestShop } from "./helpers";

test.skip(!adminCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run browser tests");

test("PSG imports, previews, commits and sends test invitations", async ({ page }) => {
  await signIn(page);
  await ensureTestShop(page);

  await ensureTestShopVersion(page);
  const id = unique();
  const domain = `@e2e-${id}.example`;
  await allowTestDomain(page, domain);

  const content = [
    "RO #,First Name,Last Name,Email,Delivered On",
    `${id}-1,Quinn,Tester,qa${domain},10/2/2026`,
    `${id}-2,Casey,Customer,casey@gmail.com,10/2/2026`,
    `${id}-3,Nora,Noemail,,10/2/2026`,
    `${id}-4,Dana,Nodate,dana${domain},`,
    `${id}-1,Quinn,Tester,qa${domain},10/2/2026`,
  ].join("\n");
  await uploadForTestShop(page, `e2e-${id}.csv`, content);

  // Preview: columns matched by name, counts shown, nothing written yet.
  await expect(page.getByLabel(/Visit ID/)).toHaveValue("RO #");
  const outcomes = page.getByRole("region", { name: "Row outcomes" });
  await expect(outcomes.getByText("Created").locator("..")).toContainText("1");
  await expect(outcomes.getByText("Duplicate").locator("..")).toContainText("1");
  await expect(outcomes.getByText("Held").locator("..")).toContainText("3");
  await expect(page.getByText("Email queued on commit")).toHaveCount(1);
  await expect(page.getByText("Test record: address not on the internal test list")).toBeVisible();

  await page.getByLabel("I reviewed the preview for this shop.").check();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Committed", { exact: true })).toBeVisible();

  // Reimporting the same file creates and sends nothing more (SR-07).
  await uploadForTestShop(page, `e2e-${id}-again.csv`, content);
  await expect(outcomes.getByText("Duplicate").locator("..")).toContainText("5");
  await expect(page.getByText("Email queued on commit")).toHaveCount(0);

  // Queue: the allowlisted one is sent; the others are held with reasons.
  await page.goto("/psg/invitations");
  await page.getByLabel("Shop", { exact: true }).selectOption({ label: TEST_SHOP.name });
  await page.waitForURL(/shop=/);
  await page.getByRole("link", { name: /^Sent/ }).click();
  await expect(page.getByText(`${id}-1`)).toBeVisible();
  await page.getByRole("link", { name: /^Held/ }).click();
  await expect(page.getByText(`${id}-2`)).toBeVisible();

  // No email: a printable link can still be issued (AT-09).
  const noEmail = page.getByRole("row", { name: new RegExp(`${id}-3`) });
  await noEmail.getByRole("button", { name: "Printable link" }).click();
  await expect(page.getByText("Printable link created.")).toBeVisible();
  await expect(page.getByRole("img", { name: new RegExp(`QR code for the survey link for visit ${id}-3`) })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download QR code" })).toHaveAttribute("download", `survey-qr-${id}-3.svg`);

  // No delivery date: fix it, which sends nothing; then it is ready to send (SR-11).
  const noDate = page.getByRole("row", { name: new RegExp(`${id}-4`) });
  await expect(noDate.getByRole("button", { name: "Printable link" })).toHaveCount(0);
  await noDate.getByRole("button", { name: "Fix details" }).click();
  await page.getByLabel("Delivery date").fill("2026-10-02");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("link", { name: /^Ready to send/ }).click();
  await page.getByRole("checkbox", { name: new RegExp(`${id}-4`) }).check();
  await page.getByRole("button", { name: "Send selected" }).click();
  await page.getByRole("button", { name: "Yes, send" }).click();
  await expect(page.getByText("1 invitation queued to send.")).toBeVisible();
});
