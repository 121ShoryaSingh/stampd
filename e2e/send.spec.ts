import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { newUser, signUpWithWorkspace } from "./helpers";

async function pdfBuffer(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return Buffer.from(await doc.save());
}

async function newEnvelope(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("link", { name: "New envelope" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create and upload PDF" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("create an envelope, upload, add a signer, place a field, send", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("sender"));
  await newEnvelope(page, "E2E Contract");

  await page.getByTestId("pdf-input").setInputFiles({ name: "contract.pdf", mimeType: "application/pdf", buffer: await pdfBuffer(2) });
  await expect(page.getByText("(2 pages)")).toBeVisible();

  await page.getByRole("link", { name: "Edit recipients and fields" }).click();
  await page.getByLabel("Recipient 1 name").fill("Ann Signer");
  await page.getByLabel("Recipient 1 email").fill("ann@e2e.dev");
  await page.getByRole("button", { name: "Save recipients" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recipients saved" })).toBeVisible();

  await page.getByRole("button", { name: "Signature" }).click();
  const page1 = page.getByTestId("page-1");
  await expect(page1.locator("canvas")).toBeVisible();
  await page1.locator("canvas").click({ position: { x: 200, y: 800 } });
  await expect(page.getByRole("button", { name: "signature field" })).toBeVisible();
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved 1 fields" })).toBeVisible();

  await page.getByRole("link", { name: "Back to envelope" }).click();
  await expect(page.getByText("1 fields placed")).toBeVisible();
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText("Sent.")).toBeVisible();
  await expect(page.getByLabel("Signing link for ann@e2e.dev")).toHaveValue(/\/sign\//);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Void envelope" })).toBeVisible();

  await page.goto("/dashboard?status=sent");
  await expect(page.getByRole("link", { name: "E2E Contract" })).toBeVisible();
});

test("a text file renamed to .pdf is rejected", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("bad"));
  await newEnvelope(page, "Bad upload");
  await page.getByTestId("pdf-input").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("just some text") });
  await expect(page.getByRole("alert").filter({ hasText: "not a valid PDF" })).toBeVisible();
});
