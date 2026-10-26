/**
 * Shop additions: PSG creates questions for one shop in the builder (no
 * scoring tabs, add_ ids), publishes them, assigns them to the shop, and a
 * customer sees them after the shared survey. PSG sees the answer marked as
 * a shop question that is not scored.
 * Requirements: SR-45; AT-45 (score equality is covered in the DB tests).
 *
 * Needs the dev server. Uses only the internal test shop, and removes the
 * shop questions from it again at the end.
 */
import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, ensureTestShop, ensureTestShopVersion, openShop, respondentPhone, signIn, TEST_SHOP, unique } from "./helpers";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

async function openTestShop(page: Page) {
  await openShop(page, TEST_SHOP.name);
  await expect(page.getByRole("heading", { name: "Shop questions" })).toBeVisible();
}

async function assignShopQuestions(page: Page, label: string) {
  await openTestShop(page);
  const select = page.getByLabel("Shop questions for new invitations");
  await expect(async () => {
    await select.selectOption({ label });
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved. Only new invitations use this.")).toBeVisible();
}

test("PSG adds questions for one shop and customers see them after the shared survey", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await ensureTestShop(page);
  await ensureTestShopVersion(page);
  const question = `Was parking easy today? ${unique()}`;

  // 1. Open the shop's questions in the builder (created on first use).
  await openTestShop(page);
  const create = page.getByRole("button", { name: "Create shop questions" });
  if (await create.isVisible()) await create.click();
  else await page.getByRole("link", { name: "Edit shop questions" }).click();
  await page.waitForURL(/\/psg\/instruments\/[0-9a-f-]{36}/);
  const instrumentPath = new URL(page.url()).pathname.replace(/\/edit$/, "");
  if (!page.url().endsWith("/edit")) {
    await page.goto(`${instrumentPath}/edit`);
    // No open draft: the page sends us to the survey (after its loading placeholder), where we start one from
    // the latest published version.
    const newDraft = page.getByRole("button", { name: /^New draft from v\d+$/ });
    await expect(page.getByRole("tab", { name: "Questions" }).or(newDraft)).toBeVisible();
    if (await newDraft.isVisible()) {
      await newDraft.click();
      await page.waitForURL(/\/edit$/);
    }
  }

  // 2. Shop questions have no scoring, alert or suppression tabs, and new ids start with add_.
  await expect(page.getByRole("tab", { name: "Questions" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Scoring|Alerts|Suppression/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Add text question/ }).click();
  await page.getByLabel("Question text").fill(question);
  await expect(page.getByLabel("Question ID")).toHaveValue(/^add_question_\d+$/);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Saved at/)).toBeVisible();
  await expect(page.getByText("No problems found")).toBeVisible();
  await page.getByRole("button", { name: "Publish…" }).click();
  await page.getByRole("button", { name: "Publish test version" }).click();
  await page.waitForURL(/\?version=\d+$/);
  const version = new URL(page.url()).searchParams.get("version");

  // 3. Assign them to the shop.
  await assignShopQuestions(page, `Shop questions v${version} (TEST)`);

  try {
    // 4. The customer sees them after the shared questions, on the public form.
    const phone = await respondentPhone(browser);
    await phone.goto(`/survey/shop/${TEST_SHOP.slug}`);
    const shared = phone.getByText("How likely are you to recommend this shop to a friend?");
    const own = phone.getByText(question);
    await expect(shared).toBeVisible();
    await expect(own).toBeVisible();
    expect((await own.boundingBox())!.y).toBeGreaterThan((await shared.boundingBox())!.y);

    const name = `Addition Customer ${unique()}`;
    await phone.getByLabel("Your name").fill(name);
    await phone.locator('input[name="public-overall_rating"][value="5"]').check({ force: true });
    await phone.getByLabel("Yes", { exact: true }).first().check();
    for (const row of ["Communication during the repair", "Quality of the repair", "Cleanliness of the vehicle at pickup"]) {
      await phone.getByRole("group", { name: row }).getByLabel("Excellent").check();
    }
    await phone.locator('input[name="public-recommend_score"][value="10"]').check({ force: true });
    await phone.getByLabel(question).fill("Plenty of spaces");
    await phone.getByRole("button", { name: "Send feedback" }).click();
    await expect(phone.getByRole("heading", { name: "Thank you for your feedback" })).toBeVisible();

    // 5. PSG sees the answer, marked as a shop question that is not scored.
    await page.goto("/psg/responses?status=visit_unmatched");
    await page.getByRole("row", { name: new RegExp(name) }).getByRole("link").first().click();
    await expect(page.getByText("Plenty of spaces")).toBeVisible();
    await expect(page.locator("dt", { hasText: question })).toContainText("Shop question, not scored");
  } finally {
    // Leave the shared test shop as other tests expect it.
    await assignShopQuestions(page, "None");
  }
});
