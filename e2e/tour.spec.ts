/**
 * Dashboards offer a guided tour on the first visit: Skip remembers the choice,
 * the button replays it, and each step names a feature of the page.
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, signIn } from "./helpers";

test.skip(!adminCredentials(), "Set E2E_EMAIL and E2E_PASSWORD to run browser tests");

test("a first visit offers the tour; skip it, replay it, or step through it", async ({ page, context }) => {
  await signIn(page);
  // A page without the helper's "tours seen" script behaves like a first visit.
  const fresh = await context.newPage();
  await fresh.goto("/psg");
  await fresh.evaluate(() => localStorage.clear());
  await fresh.reload();
  const offer = fresh.getByRole("dialog", { name: "Page tour" });
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Skip" }).click();
  await expect(offer).toBeHidden();
  await fresh.reload();
  await expect(fresh.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(offer).toBeHidden();

  // Replay from the button and step through to the end.
  await fresh.getByRole("button", { name: "Take the tour" }).click();
  const first = fresh.getByText(/^Step 1 of \d+$/);
  await expect(first).toBeVisible();
  const total = Number((await first.textContent())!.split(" of ")[1]);
  expect(total).toBeGreaterThan(5);
  for (let i = 1; i < total; i++) await fresh.getByRole("button", { name: "Next" }).click();
  await expect(fresh.getByText("System health", { exact: true }).last()).toBeVisible();
  await fresh.getByRole("button", { name: "Done" }).click();
  await expect(fresh.getByText(/^Step \d+ of \d+$/)).toBeHidden();

  // The dashboard has its own tour; Escape ends it.
  await fresh.goto("/psg/dashboard");
  await fresh.getByRole("dialog", { name: "Page tour" }).getByRole("button", { name: "Take the tour" }).click();
  await expect(fresh.getByText("Choose a shop", { exact: true })).toBeVisible();
  await fresh.getByRole("button", { name: "Next" }).click();
  await expect(fresh.getByText("Step 2 of", { exact: false })).toBeVisible();
  await fresh.keyboard.press("Escape");
  await expect(fresh.getByText(/^Step \d+ of \d+$/)).toBeHidden();
  await fresh.reload();
  await expect(fresh.getByRole("dialog", { name: "Page tour" })).toBeHidden();
});
