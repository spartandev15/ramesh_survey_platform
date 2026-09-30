/**
 * Phase 2 responses: a public shop response is saved unmatched and matched
 * by PSG from evidence; a paper form is entered for a visit; a second paper
 * form for the same visit goes to duplicate review; a correction keeps the
 * original. Uses the internal test shop and the demo survey (`npm run seed:demo`).
 * Requirements: SR-13, SR-18, SR-19, SR-20, SR-28; AT-13, AT-18, AT-19, AT-20, AT-28.
 */
import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, ensureTestShop, openShop, respondentPhone, signIn, TEST_SHOP, unique, uploadForTestShop } from "./helpers";

test.skip(!adminCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run browser tests");

/** Point the internal test shop at the demo survey's TEST version, whose questions this test answers. */
async function useDemoSurvey(page: Page) {
  await openShop(page, TEST_SHOP.name);
  const versions = page.getByLabel("Survey version for new invitations");
  const option = versions.locator("option", { hasText: /^Demo survey \(TEST\) v\d+ \(TEST\)$/ }).first();
  const value = (await option.getAttribute("value")) ?? "";
  if ((await versions.inputValue()) === value) return;
  await versions.selectOption(value);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
}

/** Answer the demo survey on a one-screen answer sheet. */
async function answerDemo(page: Page, prefix: string, rating: string) {
  await page.locator(`input[name="${prefix}-overall_rating"][value="${rating}"]`).check({ force: true });
  await page.getByLabel("Yes", { exact: true }).first().check();
  for (const row of ["Communication during the repair", "Quality of the repair", "Cleanliness of the vehicle at pickup"]) {
    await page.getByRole("group", { name: row }).getByLabel("Good").check();
  }
  await page.locator(`input[name="${prefix}-recommend_score"][value="9"]`).check({ force: true });
}

test("public, paper, duplicate and correction flows", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await ensureTestShop(page);
  await useDemoSurvey(page);
  const id = unique();
  await uploadForTestShop(page, `resp-${id}.csv`, ["RO #,First Name,Last Name,Email,Delivered On", `${id}-1,Quinn,Tester,,2026-09-10`, `${id}-2,Riley,Paper,,2026-09-10`].join("\n"));
  await page.getByLabel("I reviewed the preview for this shop.").check();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Committed", { exact: true })).toBeVisible();

  // 1. Public shop form: shop fixed by the URL, visit details optional, nothing looked up (AT-13).
  const phone = await respondentPhone(browser);
  await phone.goto(`/survey/shop/${TEST_SHOP.slug}`);
  await expect(phone.getByRole("heading", { name: `Tell ${TEST_SHOP.name} about your repair` })).toBeVisible();
  await phone.getByLabel("Your name").fill("Quinn Tester");
  await phone.getByLabel("Repair order or claim number").fill(`${id}-1`);
  await phone.getByRole("button", { name: "Send feedback" }).click();
  await expect(phone.getByRole("alert").filter({ hasText: "Some answers need attention" })).toBeFocused();
  await answerDemo(phone, "public", "4");
  await phone.getByRole("button", { name: "Send feedback" }).click();
  await expect(phone.getByRole("heading", { name: "Thank you for your feedback" })).toBeVisible();
  await expect(phone.locator("body")).not.toContainText("Riley");

  // 2. PSG matches it from evidence; it then counts exactly once (AT-28).
  await page.goto("/psg/responses?status=visit_unmatched");
  await page.getByRole("row", { name: new RegExp(`Quinn Tester · ${id}-1`) }).getByRole("link").first().click();
  await expect(page.getByText("Pending customer match").first()).toBeVisible();
  // SR-35: the page never implies the response reached FileMaker (AT-35).
  await expect(page.getByText("Not connected: this response is kept in Hub only.")).toBeVisible();
  const candidate = page.locator("label", { hasText: `${id}-1` });
  await expect(candidate).toContainText(`Visit ID ${id}-1 equals`);
  await candidate.getByRole("radio").check();
  await page.getByRole("button", { name: "Match to selected visit" }).click();
  await expect(page.getByText("Counted", { exact: true })).toBeVisible();
  await expect(page.getByText("Matched to visit")).toBeVisible();

  // 3. Paper form for the second visit, from the invitation queue (AT-18).
  await page.goto("/psg/invitations");
  await page.getByLabel("Shop", { exact: true }).selectOption({ label: TEST_SHOP.name });
  await page.waitForURL(/shop=/);
  await page.getByRole("link", { name: /^Held/ }).click();
  await page.getByRole("row", { name: new RegExp(`${id}-2`) }).getByRole("link", { name: "Paper survey" }).click();
  // The visit shows in the shop and visit card (and again in the entry summary).
  await expect(page.getByText(`${id}-2`, { exact: true })).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel(/Date the paper form was received/).fill(today);
  await answerDemo(page, "paper", "4");
  await page.getByRole("button", { name: "Save paper survey" }).click();
  await page.waitForURL(/\/psg\/responses\/[0-9a-f-]{36}$/);
  await expect(page.getByText(`Paper · received ${today} · entered by E2E Test Admin`)).toBeVisible();
  await expect(page.getByText("Counted", { exact: true })).toBeVisible();
  const firstPaper = page.url();

  // 4. The answered visit leaves the send queues (SR-24); a second paper form for it waits for duplicate review (AT-19).
  await page.goto("/psg/invitations");
  await page.getByLabel("Shop", { exact: true }).selectOption({ label: TEST_SHOP.name });
  await page.waitForURL(/shop=/);
  await page.getByRole("link", { name: /^Excluded/ }).click();
  const answered = page.getByRole("row", { name: new RegExp(`${id}-2`) });
  await expect(answered).toContainText("Survey already answered");
  await answered.getByRole("link", { name: "Paper survey" }).click();
  await expect(page.getByText("This visit already has a counted response")).toBeVisible();
  await page.getByLabel(/Date the paper form was received/).fill(today);
  await answerDemo(page, "paper", "2");
  await page.getByRole("button", { name: "Save paper survey" }).click();
  await page.waitForURL(/\/psg\/responses\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Duplicate review", { exact: true })).toBeVisible();
  await page.getByLabel("Reason (required)").fill("Customer says the second form is the correct one");
  await page.getByRole("button", { name: "Count this response instead" }).click();
  await expect(page.getByText("Counted", { exact: true })).toBeVisible();
  await page.goto(firstPaper);
  await expect(page.getByText("Duplicate, not counted")).toBeVisible();

  // 5. Correction keeps the original and shows before and after (AT-20).
  await page.getByRole("button", { name: "Correct answers" }).click();
  await page.locator('input[name="correct-overall_rating"][value="5"]').check({ force: true });
  await page.getByLabel("Reason for the correction (required)").fill("Rating misread from the paper form");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Correction: Rating misread from the paper form")).toBeVisible();
  await expect(page.getByText(/Overall, how satisfied are you with your repair experience\?: 4.* → 5/)).toBeVisible();
  await expect(page.getByText("Original submission")).toBeVisible();
});
