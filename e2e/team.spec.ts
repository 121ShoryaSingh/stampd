import { test, expect } from "@playwright/test";
import { fillSignup } from "./helpers";
import { waitForMail } from "./mail";

const stamp = Date.now();
const owner = { name: "Olive Owner", email: `owner-${stamp}@e2e.dev`, password: "correct-horse-1" };
const mate = { name: "Mo Mate", email: `mate-${stamp}@e2e.dev`, password: "correct-horse-2" };

test("owner creates a workspace, invites a teammate who joins", async ({ browser }) => {
  const ownerPage = await (await browser.newContext()).newPage();
  await ownerPage.goto("/signup");
  await fillSignup(ownerPage, owner);
  await expect(ownerPage).toHaveURL(/\/onboarding/);
  await ownerPage.getByLabel("Workspace name").fill(`E2E Co ${stamp}`);
  await ownerPage.getByRole("button", { name: "Create workspace" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Envelopes" })).toBeVisible();

  await ownerPage.goto("/settings/team");
  // Upper case on purpose: invites must match emails case-insensitively.
  await ownerPage.getByLabel("Email", { exact: true }).fill(mate.email.toUpperCase());
  const since = new Date();
  await ownerPage.getByRole("button", { name: "Invite" }).click();
  await expect(ownerPage.getByText(`Invitation emailed to ${mate.email}`)).toBeVisible();
  const inviteUrl = await ownerPage.getByTestId("invite-url").inputValue();
  expect(inviteUrl).toContain("/invite/");
  // The same link arrives by email.
  const mail = await waitForMail(mate.email, since, /invited you to E2E Co/);
  expect(mail.text).toContain(inviteUrl);

  const matePage = await (await browser.newContext()).newPage();
  await matePage.goto(inviteUrl);
  await matePage.getByRole("link", { name: "Sign up" }).click();
  await fillSignup(matePage, mate);
  await matePage.getByRole("button", { name: "Join workspace" }).click();
  await expect(matePage.getByRole("heading", { name: "Envelopes" })).toBeVisible();

  await ownerPage.reload();
  await expect(ownerPage.getByRole("cell", { name: mate.email })).toBeVisible();
});

test("unauthenticated users are sent to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
