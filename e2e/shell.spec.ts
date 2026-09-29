import { test, expect } from "@playwright/test";
import { newUser, signUpWithWorkspace } from "./helpers";

test("log out ends the session", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("leaver"));
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  // Logging out lands on the public landing page, signed out.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /log in/i }).first()).toBeVisible();
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

test("the sidebar collapses to icons, remembers it, and Ctrl+B toggles it", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("collapse"));
  const trigger = page.locator('[data-sidebar="trigger"]');
  await expect(trigger).toHaveAccessibleName("Collapse sidebar");
  await expect(page.getByLabel("Workspace")).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAccessibleName("Expand sidebar");
  // Collapsed: icons only, still reachable by name.
  await expect(page.getByLabel("Workspace")).toBeHidden();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Team" }).click();
  await expect(page).toHaveURL(/\/settings\/team/);
  await page.reload();
  await expect(trigger).toHaveAccessibleName("Expand sidebar");
  await page.keyboard.press("Control+b");
  await expect(trigger).toHaveAccessibleName("Collapse sidebar");
  await expect(page.getByLabel("Workspace")).toBeVisible();
});
