import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createAndSend, enterCode, newUser, signUpWithWorkspace } from "./helpers";
import { signingCode } from "./mail";

async function toSignStep(page: Page, email: string) {
  await enterCode(page, email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "I agree" }).click();
}

test("a repeated search parameter does not crash the dashboard", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("qq"));
  await page.goto("/dashboard?q=a&q=b");
  await expect(page.getByRole("heading", { name: "Envelopes" })).toBeVisible();
});

test("decline dialog traps focus and closes on Escape", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("esc"));
  const [link] = await createAndSend(page, "Escape Deal", [{ name: "Eli Esc", email: "eli@e2e.dev" }]);
  const signer = await (await browser.newContext()).newPage();
  await signer.goto(link);
  await toSignStep(signer, "eli@e2e.dev");
  await signer.getByRole("button", { name: "Decline" }).click();
  const dialog = signer.getByRole("dialog", { name: "Decline to sign" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await signer.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("account menu returns focus on Escape and closes when tabbing away", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("menu"));
  const trigger = page.getByRole("button", { name: "Account menu" });
  await trigger.click();
  await page.getByRole("button", { name: "Log out" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Log out" })).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "Log out" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Log out" })).toBeHidden();
});

test("the signature pad is usable on a short landscape phone", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("short"));
  const [link] = await createAndSend(page, "Short Deal", [{ name: "Sho Rt", email: "sho@e2e.dev" }]);
  const signer = await (await browser.newContext({ viewport: { width: 667, height: 375 } })).newPage();
  await signer.goto(link);
  await toSignStep(signer, "sho@e2e.dev");
  await signer.getByRole("button", { name: "signature field" }).click();
  const dialog = signer.getByRole("dialog", { name: "Adopt your signature" });
  await dialog.getByRole("button", { name: "type" }).click();
  const adopt = dialog.getByRole("button", { name: "Adopt signature" });
  await adopt.scrollIntoViewIfNeeded();
  await expect(adopt).toBeInViewport();
  await adopt.click();
  await expect(signer.getByRole("img", { name: "Your signature" })).toBeVisible();
});

test("leaving the editor with unsaved fields asks first", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("leave"));
  await page.getByRole("link", { name: "New envelope" }).click();
  await page.getByLabel("Title").fill("Leave Deal");
  await page.getByRole("button", { name: "Create and upload PDF" }).click();
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  await page.getByTestId("pdf-input").setInputFiles({ name: "l.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await page.getByRole("link", { name: "Edit recipients and fields" }).click();
  await page.getByLabel("Recipient 1 name").fill("Lee Leave");
  await page.getByLabel("Recipient 1 email").fill("lee@e2e.dev");
  await page.getByRole("button", { name: "Save recipients" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recipients saved" })).toBeVisible();
  await page.getByRole("button", { name: "Signature" }).click();
  await page.getByRole("button", { name: "Place at center" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  let asked = false;
  page.once("dialog", (d) => {
    asked = true;
    void d.dismiss();
  });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Team" }).click();
  expect(asked).toBe(true);
  await expect(page).toHaveURL(/\/edit$/);
  expect(await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("canvas").analyze().then((r) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id))).toEqual([]);
});

test("signing works with the keyboard and the sign step passes axe", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("kbsign"));
  const [link] = await createAndSend(page, "Keyboard Sign", [{ name: "Kay Board", email: "kay@e2e.dev" }]);
  const signer = await (await browser.newContext()).newPage();
  await signer.goto(link);
  const since = new Date();
  await signer.getByRole("button", { name: "Send me a code" }).focus();
  await signer.keyboard.press("Enter");
  await signer.getByLabel("Code").fill(await signingCode("kay@e2e.dev", since));
  await signer.keyboard.press("Enter");
  await signer.getByRole("checkbox").focus();
  await signer.keyboard.press("Space");
  await signer.getByRole("button", { name: "I agree" }).focus();
  await signer.keyboard.press("Enter");
  await expect(signer.getByRole("button", { name: "signature field" })).toBeVisible();
  const bad = (await new AxeBuilder({ page: signer }).withTags(["wcag2a", "wcag2aa"]).exclude("canvas").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => v.id)).toEqual([]);

  await signer.getByRole("button", { name: "signature field" }).focus();
  await signer.keyboard.press("Enter");
  const pad = signer.getByRole("dialog", { name: "Adopt your signature" });
  await pad.getByRole("button", { name: "type" }).focus();
  await signer.keyboard.press("Enter");
  await pad.getByRole("button", { name: "Adopt signature" }).focus();
  await signer.keyboard.press("Enter");
  await signer.getByRole("button", { name: "Finish" }).focus();
  await signer.keyboard.press("Enter");
  await signer.getByRole("dialog", { name: "Finish signing" }).getByRole("button", { name: "Sign and finish" }).focus();
  await signer.keyboard.press("Enter");
  await expect(signer.getByRole("heading", { name: "All done" })).toBeVisible();
});

test("after logout, Back does not show the dashboard", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("back"));
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Envelopes" })).toBeHidden();
});
