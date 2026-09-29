/**
 * Phase 2 alerts: negative feedback reaches PSG review with no shop email;
 * PSG approves an adjusted recipient list (the saved list stays as is); the
 * worker emails each recipient; the shop adds notes and requests closure;
 * only PSG resolves; internal notes stay internal; the routine-mail
 * suppression change is acknowledged only once its visit is known.
 * Requirements: SR-32, SR-33, SR-34, SR-36; AT-32, AT-33, AT-34, AT-36.
 * Needs the dev server and `npm run worker` (EMAIL_PROVIDER=log) running.
 */
import { expect, test } from "@playwright/test";
import { waitForIntent, withDb } from "./db";
import { adminCredentials, allowTestDomain, ensureTestShop, ensureTestShopVersion, gotoAndFind, openShop, respondentPhone, signIn, TEST_SHOP, unique, uploadForTestShop } from "./helpers";
import { createShopUser, submitNegativePublic } from "./shop-user";

test.skip(!adminCredentials() || !process.env.DATABASE_URL, "Set E2E_EMAIL, E2E_PASSWORD and DATABASE_URL to run browser tests");

test("negative feedback goes through PSG review, approval, follow-up and resolution", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await signIn(page);
  await ensureTestShop(page);
  await ensureTestShopVersion(page);
  const id = unique();
  const domain = `@alerts-${id}.example`;
  await allowTestDomain(page, domain);

  // The shop's saved alert recipients.
  await openShop(page, TEST_SHOP.name);
  await page.getByLabel("Negative alert recipients").fill(`owner${domain}`);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  // A visit for the respondent, so the suppression change can be identified later.
  await uploadForTestShop(page, `alerts-${id}.csv`, ["RO #,First Name,Last Name,Delivered On", `${id}-1,Alex,Unhappy,2026-09-10`].join("\n"));
  await page.getByLabel("I reviewed the preview for this shop.").check();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Committed", { exact: true })).toBeVisible();

  const shop = await createShopUser(page, browser);
  const phone = await respondentPhone(browser);
  await submitNegativePublic(phone, `Alex Unhappy ${id}`, `${id}-1`);

  // 1. PSG review item, visible result, zero shop emails (AT-32).
  const { caseId, responseId } = await withDb(async (db) => {
    const row = (
      await db.query(`SELECT c.id AS case_id, r.id AS response_id FROM alert_case c JOIN survey_response r ON r.id = c.response_id WHERE r.respondent_context->>'name' = $1`, [`Alex Unhappy ${id}`])
    ).rows[0];
    const sent = (await db.query(`SELECT count(*)::int AS n FROM email_intent e JOIN alert_approval a ON a.id = e.alert_approval_id WHERE a.case_id = $1`, [row.case_id])).rows[0];
    expect(sent.n).toBe(0);
    return { caseId: row.case_id as string, responseId: row.response_id as string };
  });
  await shop.shopPage.goto(`/shop/${shop.shopId}/responses/${responseId}`);
  await expect(shop.shopPage.getByRole("heading", { name: "Customer response" })).toBeVisible();
  await shop.shopPage.goto(`/shop/${shop.shopId}/cases`);
  await expect(shop.shopPage.locator(`a[href="/shop/${shop.shopId}/cases/${caseId}"]`)).toHaveCount(0);

  // 2. Approve & Send to an adjusted list; the saved list is unchanged (AT-33).
  // The review queue is oldest first and paged: find this case's page.
  const caseLink = page.locator(`a[href="/psg/alerts/${caseId}"]`).first();
  await gotoAndFind(page, "/psg/alerts?view=review", caseLink);
  await caseLink.click();
  await expect(page.getByText("Waiting for PSG review")).toBeVisible();
  await expect(page.getByLabel(/Send to/)).toHaveValue(`owner${domain}`);
  await page.getByLabel(/Send to/).fill(`owner${domain}\nservice${domain}`);
  await page.getByLabel(/Review note/).fill("Customer very unhappy with timing");
  await page.getByRole("button", { name: "Approve & Send" }).click();
  await page.getByRole("button", { name: "Yes, approve and send" }).click();
  await expect(page.getByText(/Approval 1 by/)).toBeVisible();
  await expect(page.getByText("Recipients were adjusted for this alert")).toBeVisible();
  await withDb(async (db) => {
    const sql = `SELECT e.state FROM email_intent e JOIN alert_approval a ON a.id = e.alert_approval_id WHERE a.case_id = $1 AND e.recipient = $2`;
    for (const r of [`owner${domain}`, `service${domain}`]) expect(await waitForIntent(db, sql, [caseId, r], ["accepted", "delivered"])).toMatch(/accepted|delivered/);
  });
  await page.reload();
  await expect(page.getByText("Accepted by the email provider")).toHaveCount(2);
  await openShop(page, TEST_SHOP.name);
  await expect(page.getByLabel("Negative alert recipients")).toHaveValue(`owner${domain}`);

  // 3. The shop follows up and requests closure; it stays open until PSG resolves (AT-34).
  await shop.shopPage.goto(`/shop/${shop.shopId}/cases`);
  await shop.shopPage.locator(`a[href="/shop/${shop.shopId}/cases/${caseId}"]`).click();
  await shop.shopPage.getByLabel("Add a note for PSG").fill("Called the customer and booked a re-check");
  await shop.shopPage.getByRole("button", { name: "Add note" }).click();
  await expect(shop.shopPage.getByText("Called the customer and booked a re-check")).toBeVisible();
  await shop.shopPage.getByLabel(/Handled\?/).fill("Re-check done, customer satisfied");
  await shop.shopPage.getByRole("button", { name: "Ask PSG to close this" }).click();
  await expect(shop.shopPage.getByText("It stays open until PSG confirms the resolution")).toBeVisible();

  // 4. PSG adds an internal note and resolves; the shop sees the outcome but not the internal note.
  await page.goto(`/psg/alerts/${caseId}`);
  await expect(page.getByText("The shop has asked to close this case.")).toBeVisible();
  await page.getByLabel("Add a note").fill(`Internal only ${id}`);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText(`Internal only ${id}`)).toBeVisible();
  await page.getByLabel("Outcome").selectOption("resolved_with_customer");
  await page.getByRole("button", { name: "Confirm resolution" }).click();
  await expect(page.getByText(/Resolved .*Resolved with the customer/)).toBeVisible();
  await shop.shopPage.reload();
  await expect(shop.shopPage.getByText(/PSG resolved this/)).toBeVisible();
  await expect(shop.shopPage.locator("body")).not.toContainText(`Internal only ${id}`);

  // 5. The suppression change needs the visit first, then an acknowledgment with evidence (AT-36).
  const row = page.getByRole("row").filter({ has: page.locator(`a[href="/psg/responses/${responseId}"]`) });
  await gotoAndFind(page, "/psg/suppression", row);
  await expect(row).toContainText("visit not matched yet");
  await expect(row).toContainText("Match the response to its visit first");
  await page.goto(`/psg/responses/${responseId}`);
  await page.locator("label", { hasText: `${id}-1` }).getByRole("radio").check();
  await page.getByRole("button", { name: "Match to selected visit" }).click();
  await expect(page.getByText("Counted", { exact: true })).toBeVisible();
  await gotoAndFind(page, "/psg/suppression", row);
  await row.getByRole("combobox").selectOption("applied");
  await row.getByPlaceholder("What you did in FileMaker").fill(`Set mail hold on ${id}-1`);
  await row.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.locator(`a[href="/psg/responses/${responseId}"]`)).toHaveCount(0);
  // Acknowledged is newest first, so it is on the first page.
  await page.goto("/psg/suppression?view=acknowledged");
  await expect(page.getByText(`Set mail hold on ${id}-1`)).toBeVisible();

  await shop.close();
});
