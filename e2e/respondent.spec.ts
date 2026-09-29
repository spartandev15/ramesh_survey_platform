/**
 * Respondent protections on the demo survey (run `npm run seed:demo` once):
 * resume, back navigation, required answers, submit-once lock and neutral
 * handling of altered links. SR-12, SR-16, SR-17, SR-39; AT-12, AT-16, AT-17.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createTestLink, ensureTestShop, openDemoSurvey, respondentPhone, signIn } from "./helpers";

test.skip(!adminCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run browser tests");

test("respondent can resume, is guided through errors, and submits exactly once", async ({ page, browser }) => {
  await signIn(page);
  await ensureTestShop(page);
  await openDemoSurvey(page);
  const url = await createTestLink(page);

  const phone = await respondentPhone(browser);
  // Submitting from a later page first reviews every page: an unanswered required question on page 1 is shown there (PDF 03 §3).
  await phone.goto(`${url}?step=2`);
  // The rating inputs are visually hidden behind their labels.
  await phone.locator('input[name="survey-recommend_score"]').first().check({ force: true });
  await phone.getByRole("button", { name: "Submit survey" }).click();
  await expect(phone.getByRole("alert").filter({ hasText: "Please check" })).toBeFocused();
  await expect(phone).toHaveURL(/\?step=1$/);
  await expect(phone.getByLabel("No", { exact: true })).toBeVisible();

  // Answer page 1; the follow-up appears only for "No"
  await phone.locator("label", { hasText: /^4$/ }).first().click();
  await expect(phone.getByText("What happened with the timing")).toHaveCount(0);
  await phone.getByLabel("No", { exact: true }).check();
  await phone.getByLabel(/What happened with the timing/).fill("One day late");
  for (const row of ["Communication during the repair", "Quality of the repair", "Cleanliness of the vehicle at pickup"]) {
    await phone.getByRole("group", { name: row }).getByLabel("Good").check();
  }
  await expect(phone.locator('[role="status"]', { hasText: /Saved [0-9]/ })).toBeVisible();

  // A save that fails is shown, and is retried by itself without losing the newer answer (AT-16).
  await phone.route("**/survey/**", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await phone.getByRole("group", { name: "Quality of the repair" }).getByLabel("Fair").check();
  await expect(phone.locator('[role="status"]', { hasText: /could not be saved/ })).toBeVisible();
  await phone.unroute("**/survey/**");
  await expect(phone.locator('[role="status"]', { hasText: /Saved [0-9]/ })).toBeVisible({ timeout: 15_000 });

  // Resume with the same link (SR-16)
  await phone.reload();
  await expect(phone.getByLabel(/What happened with the timing/)).toHaveValue("One day late");
  await expect(phone.getByRole("group", { name: "Quality of the repair" }).getByLabel("Fair")).toBeChecked();

  // Next and Back keep answers, and so do the browser's Back and Forward
  await phone.getByRole("button", { name: "Next", exact: true }).click();
  await phone.getByRole("button", { name: "Back", exact: true }).click();
  await expect(phone.getByLabel("No", { exact: true })).toBeChecked();
  await phone.getByRole("button", { name: "Next", exact: true }).click();
  await phone.goBack();
  await expect(phone.getByLabel("No", { exact: true })).toBeChecked();
  await phone.goForward();
  await expect(phone.locator('input[name="survey-recommend_score"]').first()).toBeVisible();

  // (A missing required answer being explained and focused, SR-39, is checked at the start.)
  // Keyboard selects a rating
  await phone.locator('input[name="survey-recommend_score"]').first().focus();
  await phone.keyboard.press("ArrowRight");
  await expect(phone.locator('input[name="survey-recommend_score"]:checked')).toHaveValue("1");

  // Double click submits once and locks the survey (SR-17)
  await phone.getByRole("button", { name: "Submit survey" }).dblclick();
  await expect(phone.getByRole("heading", { name: "Thank you for your feedback" })).toBeVisible();
  await phone.reload();
  await expect(phone.getByRole("heading", { name: "Thank you for your feedback" })).toBeVisible();
  await expect(phone.locator("form")).toHaveCount(0);

  // An altered link reveals nothing (AT-12)
  const altered = url.slice(0, -1) + (url.endsWith("A") ? "B" : "A");
  await phone.goto(altered);
  await expect(phone.getByText("This survey link is not valid")).toBeVisible();

  // PSG sees this link (the newest row) as submitted. Duplicate-submit races are covered by the database tests.
  await page.reload();
  const newest = page.locator('section[aria-labelledby="test-links"] tbody tr').first();
  await expect(newest).toContainText("Submitted");
  await expect(newest.getByRole("link", { name: "View answers and scores" })).toHaveCount(1);
});
