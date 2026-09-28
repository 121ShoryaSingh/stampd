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

export type Signer = { name: string; email: string };

// Sender flow: new envelope, 1-page PDF, signers in order, one signature field each, send. Returns signing links.
export async function createAndSend(page: Page, title: string, signers: Signer[]) {
  const { PDFDocument } = await import("pdf-lib");
  await page.getByRole("link", { name: "New envelope" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create and upload PDF" }).click();
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText("Agreement", { x: 50, y: 700 });
  await page.getByTestId("pdf-input").setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await expect(page.getByText("(1 pages)")).toBeVisible();

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
    await page.getByLabel("Assign to").selectOption({ label: s.name });
    await canvas.click({ position: { x: 200, y: 150 + i * 200 } });
  }
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Saved ${signers.length} fields` })).toBeVisible();

  await page.getByRole("link", { name: "Back to envelope" }).click();
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText("Sent.")).toBeVisible();
  const links: string[] = [];
  for (const s of signers) links.push(await page.getByLabel(`Signing link for ${s.email}`).inputValue());
  await page.getByRole("button", { name: "Done" }).click();
  return links.map((l) => new URL(l).pathname);
}
