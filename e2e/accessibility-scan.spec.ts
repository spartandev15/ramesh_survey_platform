/**
 * Automated WCAG 2.1 A/AA scan (axe) of the pages customers and staff use
 * most: sign-in, the respondent survey, the public shop form, the shop
 * dashboard and the main PSG pages. Serious and critical findings fail the
 * test. This adds to the keyboard-only journey in accessibility-security.spec.
 * Requirements: SR-39; AT-39.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, createTestLink, ensureTestShop, ensureTestShopVersion, openDemoSurvey, respondentPhone, signIn, TEST_SHOP } from "./helpers";

test.skip(!adminCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run browser tests");

async function scan(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${name}: ${v.id} (${v.help}) at ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

test("customer and staff pages have no serious WCAG 2.1 AA problems", async ({ page, browser }) => {
  test.setTimeout(300_000);

  // Signed out: the sign-in page.
  // axe needs a page from an explicit context.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto("/login");
  await scan(visitor, "Sign in");
  await visitorContext.close();

  await signIn(page);
  await ensureTestShop(page);
  await ensureTestShopVersion(page);
  const shopId = new URL(page.url()).pathname.split("/").pop()!;
  await scan(page, "Shop settings");

  // The respondent survey on a phone, and the public shop form.
  await openDemoSurvey(page);
  const url = await createTestLink(page);
  const phone = await respondentPhone(browser);
  await phone.goto(url);
  await scan(phone, "Respondent survey");
  await phone.goto(`/survey/shop/${TEST_SHOP.slug}`);
  await scan(phone, "Public shop form");

  for (const [path, name] of [
    ["/psg", "Overview"],
    ["/psg/shops", "Shops"],
    ["/psg/operations", "Operator queues"],
    ["/psg/imports", "Imports"],
    ["/psg/responses", "Responses"],
    ["/psg/alerts", "Alerts"],
    ["/psg/readiness", "Launch readiness"],
    [`/shop/${shopId}`, "Shop dashboard"],
  ] as const) {
    await page.goto(path);
    await scan(page, name);
  }
});
