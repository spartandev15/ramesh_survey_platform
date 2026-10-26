/**
 * Phase 1 end-to-end flow: PSG builds a survey, previews it, publishes a test
 * version, issues a test link; a respondent completes it on a phone; PSG sees
 * the answers and the server-computed outcomes with rule provenance.
 * Requirements: SR-14, SR-15, SR-16, SR-17, SR-39, SR-44, AT-14, AT-15, AT-44.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createTestLink, ensureTestShop, respondentPhone, signIn, unique } from "./helpers";

test.skip(!adminCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run browser tests");

test("PSG builds, publishes and tests a survey end to end", async ({ page, browser }) => {
  await signIn(page);
  await ensureTestShop(page);

  // 1. Create a survey
  const name = `E2E survey ${unique()}`;
  await page.goto("/psg/instruments");
  await page.getByLabel("Survey name").fill(name);
  await page.getByRole("button", { name: "Create survey" }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByText("Add at least one question")).toBeVisible();

  // 2. Build: a required rating, and a follow-up text shown only for low ratings
  await page.getByRole("button", { name: /^Add rating question/ }).click();
  await page.getByLabel("Question text").fill("How satisfied are you with the repair?");
  await page.getByLabel("Question ID").fill("repair_rating");
  await page.getByLabel("Required").selectOption("yes");

  await page.getByRole("button", { name: /^Add text question/ }).click();
  await page.getByLabel("Question text").fill("What should we have done better?");
  await page.getByLabel("Question ID").fill("do_better");
  await page.locator("fieldset", { hasText: "Show this question" }).getByRole("button", { name: "Add clause" }).click();
  await page.getByLabel("Comparison").selectOption("lte");
  await page.getByLabel("Value", { exact: true }).fill("2");

  // 3. Scoring and an alert rule
  await page.getByRole("tab", { name: /Scoring/ }).click();
  await page.getByRole("button", { name: "Add metric" }).click();
  await page.getByRole("tab", { name: /Alerts/ }).click();
  await page.getByRole("button", { name: "Add alert rule" }).click();
  await page.getByLabel("Name").fill("Low satisfaction");
  await page.getByLabel("Comparison").selectOption("lte");
  await page.getByLabel("Value", { exact: true }).fill("2");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Saved at/)).toBeVisible();
  await expect(page.getByText("No problems found")).toBeVisible();

  // 4. Preview walks the branch and shows the outcome without saving anything
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByText("What should we have done better?")).toHaveCount(0);
  await page.locator("label", { hasText: /^1$/ }).first().click();
  await expect(page.getByText("What should we have done better?")).toBeVisible();
  await expect(page.getByText("Primary: Low satisfaction")).toBeVisible();
  // ...and the other branch: a high rating hides the follow-up and fires no alert (AT-44: every branch).
  await page.locator("label", { hasText: /^5$/ }).first().click();
  await expect(page.getByText("What should we have done better?")).toHaveCount(0);
  await expect(page.getByText("Primary: Low satisfaction")).toHaveCount(0);

  // 5. Publish as a test version (AT-14: unverified content never ships as verified)
  await page.getByRole("button", { name: "Publish…" }).click();
  await page.getByRole("button", { name: "Publish test version" }).click();
  await page.waitForURL(/\?version=1$/);
  await expect(page.getByText("Test only").first()).toBeVisible();
  const versionHash = (await page.locator("dd.break-all.font-mono").first().textContent())?.trim();
  expect(versionHash).toMatch(/^[0-9a-f]{64}$/);

  // 6. Respondent completes it on a phone, signed out
  const url = await createTestLink(page);
  const phone = await respondentPhone(browser);
  await phone.goto(url);
  await expect(phone.getByText(/Test survey for internal testing/)).toBeVisible();
  await phone.locator("label", { hasText: /^2$/ }).first().click();
  await phone.getByLabel(/What should we have done better/).fill("Call me when it is ready");
  await expect(phone.locator('[role="status"]', { hasText: /Saved [0-9]/ })).toBeVisible();
  await phone.getByRole("button", { name: "Submit survey" }).click();
  await expect(phone.getByRole("heading", { name: "Thank you for your feedback" })).toBeVisible();

  // 7. PSG sees answers, outcomes and the rule version that produced them (AT-15)
  await page.reload();
  await page.getByRole("link", { name: "View answers and scores" }).first().click();
  await expect(page.getByRole("heading", { name: "Test response" })).toBeVisible();
  await expect(page.getByText("Primary: Low satisfaction")).toBeVisible();
  await expect(page.getByText("Call me when it is ready")).toBeVisible();
  await expect(page.locator("dd.font-mono", { hasText: /^2$/ })).toBeVisible(); // mean of one rating of 2
  await expect(page.getByText(versionHash!)).toBeVisible();

  // 8. A new draft keeps the published question IDs fixed (SR-15)
  await page.getByRole("link", { name: /Version 1/ }).click();
  await page.getByRole("button", { name: "New draft from v1" }).click();
  await page.waitForURL(/\/edit$/);
  await page.getByRole("button", { name: /repair_rating How satisfied/ }).click();
  await expect(page.getByLabel("Question ID")).toBeDisabled();

  // 9. "Copy a survey" starts a new survey from a chosen version (SR-44 duplication)
  await page.goto("/psg/instruments");
  await page.getByText("Copy a survey", { exact: true }).click();
  await page.getByLabel("Survey to copy").selectOption({ label: name });
  await expect(page.locator("#copy-version option:checked")).toHaveText("v1 (published, test only)");
  await expect(page.getByLabel("Survey name")).toHaveValue(`${name} copy`);
  await page.getByRole("button", { name: "Create copy" }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByRole("button", { name: /repair_rating How satisfied/ })).toBeVisible();
});
