import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createAndSend, newUser, signUpWithWorkspace } from "./helpers";

async function axe(page: Page, where: string) {
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("canvas").analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${where}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
}

async function noSideScroll(page: Page, where: string) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(extra, `${where} scrolls sideways`).toBeLessThanOrEqual(0);
}

test("public pages have no serious accessibility issues", async ({ page }) => {
  for (const path of ["/", "/login", "/signup"]) {
    await page.goto(path);
    await axe(page, path);
  }
});

test("app and signer pages have no serious accessibility issues", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("a11y"));
  for (const path of ["/dashboard", "/settings/team", "/envelopes/new"]) {
    await page.goto(path);
    await axe(page, path);
  }
  const [link] = await createAndSend(page, "Accessible Deal", [{ name: "Ada Axe", email: "ada@e2e.dev" }]);
  await axe(page, "envelope page");
  const signer = await (await browser.newContext()).newPage();
  await signer.goto(link);
  await axe(signer, "signer code step");
});

test("no page scrolls sideways at phone width", async ({ page, browser }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ["/", "/login", "/signup"]) {
    await page.goto(path);
    await noSideScroll(page, path);
  }
  await signUpWithWorkspace(page, newUser("narrow"));
  for (const path of ["/dashboard", "/settings/team", "/envelopes/new"]) {
    await page.goto(path);
    await noSideScroll(page, path);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const [link] = await createAndSend(page, "Narrow Deal", [{ name: "Nia Narrow", email: "nia@e2e.dev" }]);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  await noSideScroll(page, "envelope page");
  const signer = await (await browser.newContext({ viewport: { width: 375, height: 800 } })).newPage();
  await signer.goto(link);
  await noSideScroll(signer, "signer page");
});

test("editor fields can be placed and moved with the keyboard", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("keys"));
  await page.getByRole("link", { name: "New envelope" }).click();
  await page.getByLabel("Title").fill("Keyboard Deal");
  await page.keyboard.press("Enter");
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.getByTestId("pdf-input").setInputFiles({ name: "k.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await page.getByRole("link", { name: "Edit recipients and fields" }).click();
  await page.getByLabel("Recipient 1 name").fill("Kai Keys");
  await page.getByLabel("Recipient 1 email").fill("kai@e2e.dev");
  await page.getByRole("button", { name: "Save recipients" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Recipients saved" })).toBeVisible();

  await page.getByRole("button", { name: "Signature" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Place at center" }).focus();
  await page.keyboard.press("Enter");
  const field = page.getByRole("button", { name: "signature field" });
  await expect(field).toBeVisible();
  const before = (await field.boundingBox())!.x;
  await field.focus();
  await page.keyboard.press("ArrowRight");
  expect((await field.boundingBox())!.x).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Save fields" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("All changes saved")).toBeVisible();
});
