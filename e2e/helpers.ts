import { expect, type Browser, type Page } from "@playwright/test";

export const TEST_SHOP = { name: "E2E Collision (internal test)", slug: "e2e-collision-test" };

export function adminCredentials() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  return email && password ? { email, password } : null;
}

export async function signIn(page: Page) {
  const credentials = adminCredentials();
  if (!credentials) throw new Error("Set E2E_EMAIL and E2E_PASSWORD");
  await page.goto("/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/psg/);
}

/** An internal test shop, created once per database (SR-37: test with internal shops only). */
export async function ensureTestShop(page: Page) {
  await page.goto("/psg/shops");
  if ((await page.getByRole("cell", { name: TEST_SHOP.name }).count()) > 0) return;
  await page.getByLabel("Shop name").fill(TEST_SHOP.name);
  await page.getByLabel("Public link name").fill(TEST_SHOP.slug);
  await page.getByLabel("Internal test shop").check();
  await page.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByRole("cell", { name: TEST_SHOP.name })).toBeVisible();
}

/** Create a test link on the open version page and return its URL (shown only once). */
export async function createTestLink(page: Page): Promise<string> {
  await page.getByLabel("Shop shown on the survey").selectOption({ label: `${TEST_SHOP.name} (internal test)` });
  await page.getByRole("button", { name: "Create test link" }).click();
  const url = (await page.locator("p.font-mono.break-all").textContent())?.trim();
  if (!url?.includes("/survey/")) throw new Error("No test link shown");
  return url;
}

/** A fresh, signed-out phone browser: respondents never have a session. */
export async function respondentPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  return context.newPage();
}

export const unique = () => Date.now().toString(36);
