import { test, expect, type Browser, type Page } from "@playwright/test";
import { createAndSend, newUser, signUpWithWorkspace } from "./helpers";

async function signerPage(browser: Browser, path: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  return page;
}

// Code check, consent, draw a signature, finish.
async function signAs(page: Page) {
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await page.getByRole("button", { name: "Send me a code" }).click();
  const code = await page.getByTestId("dev-code").innerText();
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByRole("heading", { name: "Before you sign" })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "I agree" }).click();

  await page.getByRole("button", { name: "signature field" }).click();
  const pad = page.getByTestId("signature-pad");
  const b = (await pad.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + b.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 40 + i * 30, b.y + b.height * (i % 2 ? 0.35 : 0.65));
  await page.mouse.up();
  await page.getByRole("button", { name: "Adopt signature" }).click();
  await expect(page.getByRole("img", { name: "Your signature" })).toBeVisible();

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "All done" })).toBeVisible();
}

test("two signers sign in order and the envelope completes", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("owner"));
  const [link1, link2] = await createAndSend(page, "Two Step Deal", [
    { name: "Ada First", email: "ada@e2e.dev" },
    { name: "Bo Second", email: "bo@e2e.dev" },
  ]);
  const envelopeUrl = page.url();

  const second = await signerPage(browser, link2);
  await expect(second.getByRole("heading", { name: "Waiting for others" })).toBeVisible();
  // Signing tokens live in the URL, so the page must never send it as a Referer.
  await expect(second.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");

  const first = await signerPage(browser, link1);
  await signAs(first);

  await second.reload();
  await signAs(second);

  await page.goto(envelopeUrl);
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
});

test("a signer declines and the envelope closes for everyone", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("decliner"));
  const [link] = await createAndSend(page, "Declined Deal", [{ name: "Cy Nope", email: "cy@e2e.dev" }]);
  const envelopeUrl = page.url();

  const signer = await signerPage(browser, link);
  await signer.getByRole("button", { name: "Send me a code" }).click();
  await signer.getByLabel("Code").fill(await signer.getByTestId("dev-code").innerText());
  await signer.getByRole("button", { name: "Verify" }).click();
  await signer.getByRole("checkbox").check();
  await signer.getByRole("button", { name: "I agree" }).click();
  await signer.getByRole("button", { name: "Decline" }).click();
  await signer.getByLabel("Reason").fill("Terms are wrong");
  await signer.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
  await expect(signer.getByRole("heading", { name: "You declined this envelope" })).toBeVisible();

  await page.goto(envelopeUrl);
  await expect(page.getByText("declined", { exact: true }).first()).toBeVisible();
});
