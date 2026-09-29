import { expect, type Browser, type Locator, type Page } from "@playwright/test";

export const TEST_SHOP = { name: "E2E Collision (internal test)", slug: "e2e-collision-test" };

export function adminCredentials() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  return email && password ? { email, password } : null;
}

/**
 * Sign in as the e2e admin. The app rate-limits sign-in (SR-40), and a fast
 * run signs in many times, so a "Too many attempts" answer waits out the
 * limit and tries again, as a person would. The limit itself stays on.
 */
export async function signIn(page: Page) {
  const credentials = adminCredentials();
  if (!credentials) throw new Error("Set E2E_EMAIL and E2E_PASSWORD");
  await signInAs(page, credentials.email, credentials.password, /\/psg/);
}

/** Sign in any account and wait for its landing page, waiting out the sign-in rate limit (per address, shared by every test). */
export async function signInAs(page: Page, email: string, password: string, landing: RegExp) {
  for (let attempt = 1; ; attempt++) {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    const limited = page.getByText("Too many attempts");
    await expect(async () => {
      if (!landing.test(page.url()) && !(await limited.isVisible())) throw new Error("still signing in");
    }).toPass({ timeout: 60_000 });
    if (landing.test(page.url())) return;
    if (attempt === 3) throw new Error("Sign-in stayed rate limited");
    await page.waitForTimeout(61_000);
  }
}

/**
 * Lists show one page at a time. From the page shown now, follow "Next"
 * until the target appears; false when it is on none of the pages.
 * `pager` picks the list when a screen has more than one.
 */
export async function findOnPages(page: Page, target: Locator, pager: Locator = page.getByRole("navigation", { name: / pages$/ }).first()): Promise<boolean> {
  for (;;) {
    if ((await target.count()) > 0) return true;
    const next = pager.getByRole("link", { name: "Next", exact: true });
    if ((await next.count()) === 0) return false;
    const current = Number((await pager.locator('[aria-current="page"]').innerText()).replace(/\D/g, ""));
    await next.click();
    await expect(pager.locator('[aria-current="page"]')).toHaveText(`Page ${current + 1}`);
  }
}

/** Go to a paged list and fail clearly when the target is on none of its pages. */
export async function gotoAndFind(page: Page, url: string, target: Locator, pager?: Locator) {
  await page.goto(url);
  if (!(await findOnPages(page, target, pager))) throw new Error(`Not listed on any page of ${url}`);
}

/** Open a shop's settings page from the paged shop list. */
export async function openShop(page: Page, name: string) {
  const link = page.getByRole("link", { name, exact: true });
  await gotoAndFind(page, "/psg/shops", link);
  await link.click();
  await page.waitForURL(/\/psg\/shops\/[0-9a-f-]{36}/);
}

/** Create a shop from the shop list's Add shop popup and open it through the success message's link. */
export async function createShop(page: Page, input: { name: string; slug?: string; test?: boolean }) {
  await page.goto("/psg/shops");
  await page.getByRole("button", { name: "Add shop" }).click();
  await page.getByLabel("Shop name").fill(input.name);
  if (input.slug) await page.getByLabel("Public link name").fill(input.slug);
  if (input.test) await page.getByLabel("Internal test shop").check();
  await page.getByRole("button", { name: "Create shop" }).click();
  await expect(page.getByText(`Shop "${input.name}" created.`)).toBeVisible();
  await page.getByRole("link", { name: `Open ${input.name}` }).click();
  await page.waitForURL(/\/psg\/shops\/[0-9a-f-]{36}/);
}

/** An internal test shop, created once per database (SR-37: test with internal shops only). */
export async function ensureTestShop(page: Page) {
  await page.goto("/psg/shops");
  if (await findOnPages(page, page.getByRole("link", { name: TEST_SHOP.name, exact: true }))) return;
  await createShop(page, { name: TEST_SHOP.name, slug: TEST_SHOP.slug, test: true });
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

/** The internal test shop needs an assigned (TEST) survey version before imports. */
export async function ensureTestShopVersion(page: Page) {
  await openShop(page, TEST_SHOP.name);
  const versions = page.getByLabel("Survey version for new invitations");
  if (await versions.inputValue()) return;
  const option = versions.locator("option", { hasText: "(TEST)" }).first();
  await versions.selectOption((await option.getAttribute("value")) ?? "");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
}

/** Add an internal test domain so test emails to it are allowed. */
export async function allowTestDomain(page: Page, domain: string) {
  await page.goto("/psg/test-recipients");
  await fillUntilEnabled(page, "Email address or @domain", domain, "Add to list");
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByText(`Added ${domain} to the list.`).or(page.getByText("That entry is already on the list."))).toBeVisible();
  expect(await findOnPages(page, page.getByRole("cell", { name: domain, exact: true }))).toBe(true);
}

/** Open the demo survey from the paged survey list. */
export async function openDemoSurvey(page: Page) {
  const link = page.getByRole("link", { name: "Demo survey (TEST)" });
  await gotoAndFind(page, "/psg/instruments", link);
  await link.click();
}

/**
 * Type into a field until its button enables. On a slow machine a value typed
 * before React hydrates the page is reset by hydration; typing again fixes it.
 */
export async function fillUntilEnabled(page: Page, label: string, value: string, button: string) {
  await expect(async () => {
    await page.getByLabel(label).fill(value);
    await expect(page.getByRole("button", { name: button })).toBeEnabled({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
}

/** Upload a CSV for the internal test shop and land on its preview. */
export async function uploadForTestShop(page: Page, name: string, content: string) {
  await page.goto("/psg/imports");
  await page.getByLabel("Shop", { exact: true }).selectOption({ label: `${TEST_SHOP.name} (internal test)` });
  await page.getByLabel("CSV file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content) });
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.waitForURL(/\/psg\/imports\/[0-9a-f-]{36}$/);
}
