import { test, expect } from "@playwright/test";

test("landing page renders and Start free goes to signup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("signed");
  const label = page.getByText("PLACEHOLDER DATA");
  await label.scrollIntoViewIfNeeded();
  await expect(label).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("link", { name: /Send your first doc free/ }).click();
  await expect(page).toHaveURL(/\/signup/);
});

test("landing respects reduced motion", async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.locator(".lp").evaluate((el) => el.classList.contains("gsap"))).toBe(false);
});
