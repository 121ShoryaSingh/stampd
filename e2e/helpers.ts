import { expect, type Page } from "@playwright/test";

export type TestUser = { name: string; email: string; password: string };

export function newUser(tag: string): TestUser {
  const s = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return { name: `${tag} User`, email: `${tag}-${s}@e2e.dev`, password: "correct-horse-1" };
}

export async function fillSignup(page: Page, u: TestUser) {
  await page.getByLabel("Your name").fill(u.name);
  await page.getByLabel("Work email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function signUpWithWorkspace(page: Page, u: TestUser) {
  await page.goto("/signup");
  await fillSignup(page, u);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Workspace name").fill(`${u.name} Co`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Envelopes" })).toBeVisible();
}
