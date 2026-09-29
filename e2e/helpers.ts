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

async function onePagePdf() {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText("Agreement", { x: 50, y: 700 });
  return Buffer.from(await doc.save());
}

// Wizard steps 1 and 2: title, then the PDF (1 page unless given). Ends on the recipients step.
export async function startEnvelope(page: Page, title: string, pdf?: Buffer) {
  await page.getByRole("link", { name: "New envelope" }).first().click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/upload$/);
  await page.getByTestId("pdf-input").setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: pdf ?? (await onePagePdf()) });
  await expect(page.getByText(/\d+ pages/)).toBeVisible();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/recipients$/);
}

// Wizard step 3: signers in order. Ends on the fields step.
export async function addRecipients(page: Page, people: Signer[]) {
  for (const [i, s] of people.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add recipient" }).click();
    await page.getByLabel(`Recipient ${i + 1} name`).fill(s.name);
    await page.getByLabel(`Recipient ${i + 1} email`).fill(s.email);
  }
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/fields$/);
}

// Wizard step 5 from the fields step: continue to review, then send. Lands on the status page.
export async function reviewAndSend(page: Page) {
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText("Sent. Signing emails are on their way.")).toBeVisible();
}

// Sender flow: new envelope, 1-page PDF, signers in order, one signature field each, send.
// Returns the first signer's link (from the invite email); later signers are invited when their step starts.
export async function createAndSend(page: Page, title: string, signers: Signer[], opts: { choice?: boolean; beforeSave?: (page: Page) => Promise<void> } = {}) {
  await startEnvelope(page, title);
  await addRecipients(page, signers);

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

  const since = new Date();
  await reviewAndSend(page);
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
