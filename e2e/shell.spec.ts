import { test, expect } from "@playwright/test";
import { newUser, signUpWithWorkspace } from "./helpers";

test("log out ends the session", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("leaver"));
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("on a phone the menu button opens navigation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signUpWithWorkspace(page, newUser("phone"));
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Team" }).click();
  await expect(page).toHaveURL(/\/settings\/team/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
