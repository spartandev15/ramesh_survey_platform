/**
 * Usability, branding and data protection checks.
 * - A respondent completes and submits the survey with the keyboard only (AT-39).
 * - A shop logo that fails to load falls back to the shop name, on phone and desktop (AT-02).
 * - Survey pages are never stored by shared caches (PDF 04, SR-40).
 * - A shop user cannot open PSG operator or readiness pages (AT-01, AT-40).
 * Requirements: SR-02, SR-39, SR-40.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { adminCredentials, createShop, createTestLink, ensureTestShop, ensureTestShopVersion, findOnPages, openDemoSurvey, openShop, respondentPhone, signIn, TEST_SHOP } from "./helpers";
import { createShopUser } from "./shop-user";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

/** Press Tab until the element is focused, proving it is reachable in tab order. */
async function tabTo(page: Page, isTarget: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 120; i++) {
    if (await isTarget()) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`${what} is not reachable with the Tab key`);
}
const focusedName = (page: Page, name: string) => () => page.evaluate((n) => document.activeElement?.getAttribute("name") === n, name);
const isFocused = (locator: Locator) => () => locator.evaluate((el) => el === document.activeElement);

test("a respondent completes the survey with the keyboard only (AT-39)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await ensureTestShop(page);
  await openDemoSurvey(page);
  const url = await createTestLink(page);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const survey = await context.newPage();
  await survey.goto(url);
  await expect(survey.getByRole("heading", { name: "Your repair experience" })).toBeVisible();
  await survey.waitForLoadState("networkidle");

  // Rating 4 of 5: Tab into the group, Space picks the first, arrows move.
  await tabTo(survey, focusedName(survey, "survey-overall_rating"), "Overall rating");
  await survey.keyboard.press("Space");
  for (let i = 0; i < 3; i++) await survey.keyboard.press("ArrowRight");
  await expect(survey.locator('input[name="survey-overall_rating"]:checked')).toHaveValue("4");

  await tabTo(survey, focusedName(survey, "survey-ready_on_time"), "Ready on time");
  await survey.keyboard.press("Space");
  await expect(survey.getByLabel("Yes", { exact: true })).toBeChecked();

  for (const row of ["communication", "quality", "cleanliness"]) {
    const name = `survey-service_aspects-${row}`;
    const inputs = survey.locator(`input[name="${name}"]`);
    // Fall back to any radio in the row's group if the row uses another naming scheme.
    const target = (await inputs.count()) > 0 ? focusedName(survey, name) : isFocused(survey.getByRole("group", { name: new RegExp(row, "i") }).getByRole("radio").first());
    await tabTo(survey, target, `Matrix row ${row}`);
    await survey.keyboard.press("Space");
    await survey.keyboard.press("ArrowRight");
    await survey.keyboard.press("ArrowRight");
  }
  for (const row of ["Communication during the repair", "Quality of the repair", "Cleanliness of the vehicle at pickup"]) {
    await expect(survey.getByRole("group", { name: row }).getByLabel("Good")).toBeChecked();
  }
  // Saved state is written out, not shown by colour alone.
  await expect(survey.locator('[role="status"]', { hasText: /Saved [0-9]/ })).toBeVisible();

  const next = survey.getByRole("button", { name: "Next", exact: true });
  await tabTo(survey, isFocused(next), "Next");
  await survey.keyboard.press("Enter");
  await expect(survey.getByText("How likely are you to recommend this shop to a friend?")).toBeVisible();

  await tabTo(survey, focusedName(survey, "survey-recommend_score"), "Recommend score");
  await survey.keyboard.press("Space");
  for (let i = 0; i < 9; i++) await survey.keyboard.press("ArrowRight");
  await expect(survey.locator('input[name="survey-recommend_score"]:checked')).toHaveValue("9");

  const submit = survey.getByRole("button", { name: "Submit survey" });
  await tabTo(survey, isFocused(submit), "Submit survey");
  await survey.keyboard.press("Enter");
  await expect(survey.getByRole("heading", { name: "Thank you for your feedback" })).toBeVisible();
  await context.close();
});

test("a logo that fails to load falls back to the shop name, and survey pages are not cached (AT-02, SR-40)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await ensureTestShop(page);
  await openShop(page, TEST_SHOP.name);
  const logo = page.getByLabel("Approved logo link");
  const save = async (value: string) => {
    await expect(async () => {
      await logo.fill(value);
      await expect(logo).toHaveValue(value, { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
  };
  // ".invalid" never resolves, so the image always fails.
  await save("https://logo.invalid/psg-e2e.png");

  try {
    const phone = await respondentPhone(browser);
    const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    for (const view of [phone, desktop]) {
      const response = await view.goto(`/survey/shop/${TEST_SHOP.slug}`);
      expect(response?.headers()["cache-control"]).toContain("no-store");
      const header = view.locator("header").first();
      await expect(header.getByText(TEST_SHOP.name, { exact: true })).toBeVisible();
      await expect(header.locator("img")).toHaveCount(0);
    }
    // A personalized link, even an invalid one, is never cached either.
    const tokenPage = await phone.request.get(`/survey/${"A".repeat(43)}`);
    expect(tokenPage.headers()["cache-control"]).toContain("no-store");
  } finally {
    await save("");
  }
});

test("two shops each show their own name and colour, on phone and desktop (AT-02)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await ensureTestShop(page);
  await ensureTestShopVersion(page);
  const other = { name: "E2E Branding B (internal test)", slug: "e2e-branding-b" };

  // A second internal test shop with a survey version and its own colour.
  await page.goto("/psg/shops");
  if (await findOnPages(page, page.getByRole("link", { name: other.name, exact: true }))) await openShop(page, other.name);
  else await createShop(page, { name: other.name, slug: other.slug, test: true });
  const versions = page.getByLabel("Survey version for new invitations");
  const option = versions.locator("option", { hasText: "(TEST)" }).first();
  await expect(async () => {
    await versions.selectOption((await option.getAttribute("value")) ?? "");
    await page.getByLabel("Brand colour", { exact: true }).fill("#0f6b3f");
    await expect(page.getByLabel("Brand colour", { exact: true })).toHaveValue("#0f6b3f", { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  const phone = await respondentPhone(browser);
  const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  for (const view of [phone, desktop]) {
    const colours: string[] = [];
    for (const s of [TEST_SHOP, other]) {
      await view.goto(`/survey/shop/${s.slug}`);
      const header = view.locator("header").first();
      await expect(header).toContainText(s.name);
      // Never the other shop's name.
      await expect(header).not.toContainText(s === TEST_SHOP ? other.name : TEST_SHOP.name);
      colours.push(await header.evaluate((el) => getComputedStyle(el).backgroundColor));
    }
    expect(colours[1]).toBe("rgb(15, 107, 63)");
    expect(colours[0]).not.toBe(colours[1]);
  }
});

test("a shop user cannot open PSG operator or readiness pages (AT-01)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await ensureTestShop(page);
  const { shopPage, close } = await createShopUser(page, browser);
  try {
    for (const path of ["/psg/operations", "/psg/readiness", "/psg"]) {
      const response = await shopPage.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(shopPage.getByText("Operator queues")).toHaveCount(0);
    }
  } finally {
    await close();
  }
});
