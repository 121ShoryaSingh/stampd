import { test, expect } from "@playwright/test";
import { newUser, signUpWithWorkspace } from "./helpers";

const animationOf = (page: import("@playwright/test").Page) =>
  page.getByText("Awaiting signature").locator("..").evaluate((el) => getComputedStyle(el).animationName);

test("dashboard tiles animate in by default", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("motion"));
  expect(await animationOf(page)).toBe("rise");
});

test("nothing animates with reduced motion", async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  await signUpWithWorkspace(page, newUser("still"));
  expect(await animationOf(page)).toBe("none");
});
