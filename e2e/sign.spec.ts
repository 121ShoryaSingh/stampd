import { test, expect, type Browser, type Page } from "@playwright/test";
import { createAndSend, enterCode, newUser, signUpWithWorkspace } from "./helpers";
import { signingLink, waitForMail } from "./mail";

const signingCopy = (to: string, title: string, since: Date) => waitForMail(to, since, new RegExp(`^Your signed copy of "${title}"$`));

async function signerPage(browser: Browser, path: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  return page;
}

// Code check, consent, draw a signature, finish.
async function signAs(page: Page, email: string) {
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await enterCode(page, email);

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
  await page.getByRole("dialog", { name: "Adopt your signature" }).getByRole("button", { name: "Adopt signature" }).click();
  await expect(page.getByRole("img", { name: "Your signature" })).toBeVisible();

  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("dialog", { name: "Finish signing" }).getByRole("button", { name: "Sign and finish" }).click();
  await expect(page.getByRole("heading", { name: "All done" })).toBeVisible();
}

test("two signers sign in order and the envelope completes", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("owner"));
  const [link1] = await createAndSend(page, "Two Step Deal", [
    { name: "Ada First", email: "ada@e2e.dev" },
    { name: "Bo Second", email: "bo@e2e.dev" },
  ]);
  const envelopeUrl = page.url();
  // Step 2 has no link yet.
  await expect(page.getByText("Waiting for earlier steps")).toBeVisible();

  const first = await signerPage(browser, link1);
  // Signing tokens live in the URL, so the page must never send it as a Referer.
  await expect(first.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  const since = new Date();
  await signAs(first, "ada@e2e.dev");

  const second = await signerPage(browser, await signingLink("bo@e2e.dev", "Two Step Deal", since));
  await signAs(second, "bo@e2e.dev");

  await page.goto(envelopeUrl);
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();

  // The worker seals the PDF; the page picks it up by itself.
  const download = page.getByRole("link", { name: "Download signed PDF" });
  await expect(download).toBeVisible({ timeout: 45_000 });
  const pdf = await page.request.get(`${envelopeUrl}/signed`);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const body = (await pdf.body()).toString("latin1");
  expect(body.startsWith("%PDF-")).toBe(true);
  expect(body).toContain("/SubFilter /ETSI.CAdES.detached");
  // Every signer gets their copy by email.
  await signingCopy("ada@e2e.dev", "Two Step Deal", since);
  await signingCopy("bo@e2e.dev", "Two Step Deal", since);
});

test("a signer must answer a Yes/No question before finishing", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("owner"));
  const [link] = await createAndSend(page, "Choice Deal", [{ name: "Cy Choice", email: "cy@e2e.dev" }], { choice: true });
  const signer = await signerPage(browser, link);
  await enterCode(signer, "cy@e2e.dev");
  await signer.getByRole("checkbox").check();
  await signer.getByRole("button", { name: "I agree" }).click();
  const question = signer.getByRole("radiogroup", { name: "Yes or No question" });
  await expect(question).toBeVisible();
  await expect(signer.getByText("0 of 2 required")).toBeVisible();
  await question.getByRole("radio", { name: "No" }).click();
  await expect(question.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");
  await expect(signer.getByText("1 of 2 required")).toBeVisible();
});

test("a signer declines and the envelope closes for everyone", async ({ page, browser }) => {
  await signUpWithWorkspace(page, newUser("decliner"));
  const [link] = await createAndSend(page, "Declined Deal", [{ name: "Cy Nope", email: "cy@e2e.dev" }]);
  const envelopeUrl = page.url();

  const signer = await signerPage(browser, link);
  await enterCode(signer, "cy@e2e.dev");
  await signer.getByRole("checkbox").check();
  await signer.getByRole("button", { name: "I agree" }).click();
  await signer.getByRole("button", { name: "Decline" }).click();
  await signer.getByLabel("Reason").fill("Terms are wrong");
  await signer.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
  await expect(signer.getByRole("heading", { name: "You declined this envelope" })).toBeVisible();

  await page.goto(envelopeUrl);
  await expect(page.getByText("declined", { exact: true }).first()).toBeVisible();
});
