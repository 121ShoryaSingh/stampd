import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { addRecipients, newUser, reviewAndSend, signUpWithWorkspace, startEnvelope } from "./helpers";
import { signingLink } from "./mail";

const TITLE = "E2E Contract";

async function pdfBuffer(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return Buffer.from(await doc.save());
}

async function newEnvelope(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("link", { name: "New envelope" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page).toHaveURL(/\/upload$/);
}

test("create an envelope, upload, add a signer, place a field, send", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("sender"));
  await newEnvelope(page, TITLE);

  await page.getByTestId("pdf-input").setInputFiles({ name: "contract.pdf", mimeType: "application/pdf", buffer: await pdfBuffer(2) });
  await expect(page.getByText(/2 pages/)).toBeVisible();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await addRecipients(page, [{ name: "Ann Signer", email: "ann@e2e.dev" }]);

  await page.getByRole("button", { name: "Signature" }).click();
  const page1 = page.getByTestId("page-1");
  await expect(page1.locator("canvas")).toBeVisible();
  await page1.locator("canvas").click({ position: { x: 200, y: 800 } });
  await expect(page.getByRole("button", { name: "signature field" })).toBeVisible();
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved 1 fields" })).toBeVisible();

  const since = new Date();
  await reviewAndSend(page);
  await expect(page.getByText(/1 fields placed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Void envelope" })).toBeVisible();
  const first = await signingLink("ann@e2e.dev", TITLE, since);
  await expect(page.getByText(/Invite email/).first()).toBeVisible();

  // Resend issues a new link by email; the old one stops working.
  const again = new Date();
  await page.getByRole("button", { name: "Resend email to ann@e2e.dev" }).click();
  await expect(page.getByText("New link emailed to ann@e2e.dev")).toBeVisible();
  // Both invites share a subject; wait until the newest one carries a different link.
  await expect.poll(() => signingLink("ann@e2e.dev", TITLE, again), { timeout: 30_000 }).not.toBe(first);
  const old = await page.request.get(first);
  expect(await old.text()).toContain("This link is not valid");

  // The document link is minted fresh on each click.
  const doc = await page.request.get(page.url().split("?")[0] + "/document", { maxRedirects: 0 });
  expect(doc.status()).toBe(307);
  expect(doc.headers()["location"]).toContain("/doc/");

  await page.getByRole("button", { name: "Void envelope" }).click();
  const dialog = page.getByRole("dialog", { name: "Void envelope" });
  await dialog.getByLabel("Reason for voiding").fill("Sent by mistake");
  await dialog.getByRole("button", { name: "Void", exact: true }).click();
  await expect(page.getByText("Voided: Sent by mistake")).toBeVisible();

  await page.goto("/dashboard?status=voided");
  await expect(page.getByRole("link", { name: "E2E Contract", exact: true })).toBeVisible();
});

test("a text file renamed to .pdf is rejected", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("bad"));
  await newEnvelope(page, "Bad upload");
  await page.getByTestId("pdf-input").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("just some text") });
  await expect(page.getByRole("alert").filter({ hasText: "not a valid PDF" })).toBeVisible();
});

test("the expiry date is picked from a calendar", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("dates"));
  // The send options are on the last step.
  await startEnvelope(page, "Dated Deal");
  await addRecipients(page, [{ name: "Dee Date", email: "dee@e2e.dev" }]);
  await page.getByRole("button", { name: "Signature" }).click();
  await page.getByRole("button", { name: "Place at center" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await page.getByRole("button", { name: /Expires on/ }).click();
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  await grid.getByRole("button", { name: /15th/ }).first().click();
  await expect(page.getByRole("button", { name: /Expires on: .*15th/ })).toBeVisible();
});

test("deleting a draft asks in our own dialog first", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("deleter"));
  await startEnvelope(page, "Doomed Draft");
  await addRecipients(page, [{ name: "Dot Doom", email: "dot@e2e.dev" }]);
  await page.getByRole("button", { name: "Signature" }).click();
  await page.getByRole("button", { name: "Place at center" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/review$/);

  await page.getByRole("button", { name: "Delete draft" }).click();
  const ask = page.getByRole("dialog", { name: "Delete this draft?" });
  await expect(ask).toContainText("Doomed Draft");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toBeHidden();
  await expect(page).toHaveURL(/\/review$/);

  await page.getByRole("button", { name: "Delete draft" }).click();
  await ask.getByRole("button", { name: "Delete draft" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Doomed Draft" })).toHaveCount(0);
});
