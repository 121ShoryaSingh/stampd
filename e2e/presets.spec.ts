import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fillSignup, newUser, settle, signUpWithWorkspace } from "./helpers";
import { signingLink, waitForMail } from "./mail";

async function uploadPdf(page: Page) {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText("Agreement", { x: 50, y: 700 });
  await page.getByTestId("pdf-input").setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
}

async function axe(page: Page, where: string) {
  await settle(page);
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("canvas").analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
}

// Places one signature per role label on page 1.
async function placeSignatures(page: Page, labels: string[]) {
  const canvas = page.getByTestId("page-1").locator("canvas");
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "Signature" }).click();
  for (const [i, label] of labels.entries()) {
    await page.getByLabel("Assign to").selectOption({ label });
    await canvas.click({ position: { x: 200, y: 150 + i * 200 } });
  }
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Saved ${labels.length} fields` })).toBeVisible();
}

test.use({ reducedMotion: "reduce" });

test("an admin builds a preset and starts an envelope from it", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("preset"));
  await page.getByRole("link", { name: "Presets" }).first().click();
  await expect(page.getByRole("heading", { name: "Presets", exact: true })).toBeVisible();
  await expect(page.getByText("No presets yet.")).toBeVisible();
  await axe(page, "/presets empty");

  await page.getByRole("link", { name: "New preset" }).click();
  await page.getByLabel("Name").fill("Service agreement");
  await page.getByRole("button", { name: "Create preset" }).click();
  await expect(page.getByRole("heading", { name: "Service agreement" })).toBeVisible();

  await uploadPdf(page);
  await expect(page.getByText(/agreement\.pdf - 1 page/)).toBeVisible();
  await page.getByLabel("Role 1 name").fill("Client");
  await page.getByRole("button", { name: "Add role" }).click();
  await page.getByLabel("Role 2 name").fill("Manager");
  await page.getByLabel("Role 2 default person").fill("Mia Manager");
  await page.getByLabel("Role 2 default email").fill("mia@e2e.dev");
  await page.getByRole("button", { name: "Save roles" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Roles saved" })).toBeVisible();
  await placeSignatures(page, ["Client", "Manager"]);
  await axe(page, "preset editor");

  await page.getByRole("link", { name: "Use preset" }).click();
  await expect(page.getByLabel("Manager email")).toHaveValue("mia@e2e.dev");
  await page.getByLabel("Title").fill("Service agreement for Acme");
  await page.getByLabel("Client name").fill("Cal Client");
  await page.getByLabel("Client email").fill("cal@e2e.dev");
  await axe(page, "use preset");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: "Service agreement for Acme" })).toBeVisible();
  await expect(page.getByText("Envelope created from a preset")).toBeVisible();

  const since = new Date();
  await page.getByRole("button", { name: "Send for signature" }).click();
  await expect(page.getByText("Sent. Signing emails are on their way.")).toBeVisible();
  expect(await signingLink("cal@e2e.dev", "Service agreement for Acme", since)).toContain("/sign/");

  await page.goto("/presets");
  const row = page.getByRole("row").filter({ hasText: "Service agreement" });
  await expect(row.getByRole("cell", { name: "1", exact: true })).toBeVisible();
});

test("save a draft as a preset, duplicate it, archive and restore", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("saver"));
  await page.getByRole("link", { name: "New envelope" }).first().click();
  await page.getByLabel("Title").fill("Lease");
  await page.getByRole("button", { name: "Create and upload PDF" }).click();
  await uploadPdf(page);
  await expect(page.getByText(/1 pages/)).toBeVisible();
  await page.getByRole("link", { name: "Edit recipients and fields" }).click();
  await page.getByLabel("Recipient 1 name").fill("Tia Tenant");
  await page.getByLabel("Recipient 1 email").fill("tia@e2e.dev");
  await page.getByRole("button", { name: "Save recipients" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recipients saved" })).toBeVisible();
  await placeSignatures(page, ["Tia Tenant"]);
  await page.getByRole("link", { name: "Back to envelope" }).click();

  await page.getByRole("button", { name: "Save as preset" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as preset" });
  await dialog.getByLabel("Preset name").fill("Standard lease");
  await dialog.getByRole("button", { name: "Save preset" }).click();
  await expect(dialog.getByText("Preset saved.")).toBeVisible();
  await dialog.getByRole("link", { name: "Open preset" }).click();
  await expect(page.getByRole("heading", { name: "Standard lease" })).toBeVisible();
  await expect(page.getByLabel("Role 1 name")).toHaveValue("Tia Tenant");
  await expect(page.getByLabel("Role 1 default email")).toHaveValue("tia@e2e.dev");

  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: "Standard lease (copy)" })).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

  await page.goto("/presets");
  await expect(page.getByRole("link", { name: "Standard lease", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Standard lease (copy)" })).toHaveCount(0);
  await page.getByRole("link", { name: "archived" }).click();
  await page.getByRole("link", { name: "Standard lease (copy)" }).click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("link", { name: "Use preset" })).toBeVisible();

  // The new envelope page offers the preset too.
  await page.goto("/envelopes/new");
  await expect(page.getByRole("heading", { name: "Start from a preset" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Standard lease/ }).first()).toBeVisible();
});

test("members can use presets but not manage them", async ({ browser }) => {
  const stamp = Date.now();
  const owner = { name: "Pia Owner", email: `powner-${stamp}@e2e.dev`, password: "correct-horse-1" };
  const mate = { name: "Max Member", email: `pmate-${stamp}@e2e.dev`, password: "correct-horse-2" };
  const ownerPage = await (await browser.newContext()).newPage();
  await signUpWithWorkspace(ownerPage, owner);
  await ownerPage.goto("/presets/new");
  await ownerPage.getByLabel("Name").fill("Team NDA");
  await ownerPage.getByRole("button", { name: "Create preset" }).click();
  await expect(ownerPage.getByRole("heading", { name: "Team NDA" })).toBeVisible();
  await uploadPdf(ownerPage);
  await ownerPage.getByLabel("Role 1 name").fill("Party");
  await ownerPage.getByRole("button", { name: "Save roles" }).click();
  await expect(ownerPage.getByRole("status").filter({ hasText: "Roles saved" })).toBeVisible();
  await placeSignatures(ownerPage, ["Party"]);

  await ownerPage.goto("/settings/team");
  await ownerPage.getByLabel("Email", { exact: true }).fill(mate.email);
  const since = new Date();
  await ownerPage.getByRole("button", { name: "Invite" }).click();
  await waitForMail(mate.email, since, /invited you to/);
  const inviteUrl = await ownerPage.getByTestId("invite-url").inputValue();

  const matePage = await (await browser.newContext()).newPage();
  await matePage.goto(inviteUrl);
  await matePage.getByRole("link", { name: "Sign up" }).click();
  await fillSignup(matePage, mate);
  await matePage.getByRole("button", { name: "Join workspace" }).click();
  await expect(matePage.getByRole("heading", { name: "Envelopes" })).toBeVisible();

  await matePage.goto("/presets");
  await expect(matePage.getByText("Team NDA")).toBeVisible();
  await expect(matePage.getByRole("link", { name: "New preset" })).toHaveCount(0);
  await expect(matePage.getByRole("link", { name: "archived" })).toHaveCount(0);
  await matePage.goto("/presets/new");
  await expect(matePage).toHaveURL(/\/presets$/);
  await matePage.getByRole("link", { name: "Use Team NDA" }).click();
  await matePage.getByLabel("Party name").fill("Pat Party");
  await matePage.getByLabel("Party email").fill("pat@e2e.dev");
  await matePage.getByRole("button", { name: "Create draft" }).click();
  await expect(matePage.getByRole("heading", { name: "Team NDA" })).toBeVisible();
  await expect(matePage.getByRole("button", { name: "Save as preset" })).toHaveCount(0);
});
