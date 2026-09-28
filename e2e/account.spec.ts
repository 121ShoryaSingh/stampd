import { test, expect } from "@playwright/test";
import { newUser, signUpWithWorkspace } from "./helpers";
import { waitForMail } from "./mail";

test("a forgotten password is reset by email, and the old one stops working", async ({ page, browser }) => {
  const u = newUser("forgot");
  await signUpWithWorkspace(page, u);

  const guest = await (await browser.newContext()).newPage();
  await guest.goto("/login");
  await guest.getByRole("link", { name: "Forgot password?" }).click();
  await expect(guest.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await guest.getByLabel("Work email").fill(u.email);
  const since = new Date();
  await guest.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(guest.getByText(`If there is a Stampd account for ${u.email}`)).toBeVisible();

  const mail = await waitForMail(u.email, since, /^Reset your Stampd password$/);
  const link = mail.text.match(/https?:\/\/\S+\/reset-password\/\S+/)![0];
  await guest.goto(link);
  await expect(guest).toHaveURL(/\/reset-password\?token=/);
  await guest.getByLabel("New password", { exact: true }).fill("brand-new-pass-9");
  await guest.getByLabel("Repeat new password").fill("brand-new-pass-9");
  await guest.getByRole("button", { name: "Save new password" }).click();
  await expect(guest.getByText("Password changed. Log in with your new password.")).toBeVisible();

  // The old password is refused, the new one works.
  await guest.getByLabel("Work email").fill(u.email);
  await guest.getByLabel("Password").fill(u.password);
  await guest.getByRole("button", { name: "Log in" }).click();
  await expect(guest.getByRole("alert")).toBeVisible();
  await guest.getByLabel("Password").fill("brand-new-pass-9");
  await guest.getByRole("button", { name: "Log in" }).click();
  await expect(guest.getByRole("heading", { name: "Envelopes" })).toBeVisible();

  // The link works once.
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "Link expired" })).toBeVisible();
});

test("asking for a reset for an unknown email looks the same", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Work email").fill(`nobody-${Date.now()}@e2e.dev`);
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByText(/If there is a Stampd account for nobody-/)).toBeVisible();
});

test("the login form cannot be submitted before the page is ready", async ({ page }) => {
  // A plain HTML submit would put the password in the URL; the button waits for JavaScript.
  await page.route("**/_next/static/**", (route) => route.abort());
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Log in" })).toBeDisabled();
});
