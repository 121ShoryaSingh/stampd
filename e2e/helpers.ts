import { expect, type Page } from "@playwright/test";
import { signingCode, signingLink } from "./mail";

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

export type Signer = { name: string; email: string };

// Sender flow: new envelope, 1-page PDF, signers in order, one signature field each, send.
// Returns the first signer's link (from the invite email); later signers are invited when their step starts.
export async function createAndSend(page: Page, title: string, signers: Signer[], opts: { choice?: boolean; beforeSave?: (page: Page) => Promise<void> } = {}) {
  const { PDFDocument } = await import("pdf-lib");
  await page.getByRole("link", { name: "New envelope" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create and upload PDF" }).click();
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText("Agreement", { x: 50, y: 700 });
  await page.getByTestId("pdf-input").setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await expect(page.getByText(/1 pages/)).toBeVisible();

  await page.getByRole("link", { name: "Edit recipients and fields" }).click();
  for (const [i, s] of signers.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add recipient" }).click();
    await page.getByLabel(`Recipient ${i + 1} name`).fill(s.name);
    await page.getByLabel(`Recipient ${i + 1} email`).fill(s.email);
  }
  await page.getByRole("button", { name: "Save recipients" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recipients saved" })).toBeVisible();

  const canvas = page.getByTestId("page-1").locator("canvas");
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "Signature" }).click();
  for (const [i, s] of signers.entries()) {
    await page.getByRole("radio", { name: s.name }).click();
    await canvas.click({ position: { x: 200, y: 150 + i * 200 } });
  }
  // Optional Yes/No question for the first signer: two answer boxes.
  if (opts.choice) {
    await page.getByRole("button", { name: "Choice (Yes / No)" }).click();
    await page.getByRole("radio", { name: signers[0].name }).click();
    await canvas.click({ position: { x: 200, y: 600 } });
  }
  await opts.beforeSave?.(page);
  const count = signers.length + (opts.choice ? 2 : 0);
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Saved ${count} fields` })).toBeVisible();

  await page.getByRole("link", { name: "Back to envelope" }).click();
  const since = new Date();
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText("Sent. Signing emails are on their way.")).toBeVisible();
  return [await signingLink(signers[0].email, title, since)];
}

// Signer: request a code, read it from the email, verify.
export async function enterCode(page: Page, email: string) {
  const since = new Date();
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText(`We emailed a 6-digit code to ${email}`)).toBeVisible();
  await page.getByLabel("Code").fill(await signingCode(email, since));
  await page.getByRole("button", { name: "Verify" }).click();
}

// Waits for entrance animations (fades, slides) to finish, so contrast is measured on the final colors.
// Endless animations (skeleton shimmer, marquee) are ignored.
export async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity),
  );
}
