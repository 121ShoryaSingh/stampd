import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  { path: "/security", heading: "Security" },
  { path: "/terms", heading: "Terms of service" },
  { path: "/privacy", heading: "Privacy policy" },
  { path: "/forgot-password", heading: "Forgot your password?" },
];

for (const p of PAGES) {
  test(`${p.path} renders, passes axe and fits a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(p.path);
    await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
    const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => v.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("legal drafts say they are drafts", async ({ page }) => {
  for (const path of ["/terms", "/privacy"]) {
    await page.goto(path);
    await expect(page.getByRole("note")).toContainText("Draft for review, not legal advice");
  }
});

test("every landing link goes somewhere real, and pricing is marked as a placeholder", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("PLACEHOLDER PRICING")).toBeAttached();
  const hrefs = await page.locator(".lp a[href]").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!))]);
  expect(hrefs).not.toContain("#");
  for (const href of hrefs.filter((h) => h.startsWith("/"))) {
    const res = await request.get(href, { maxRedirects: 0 });
    expect(res.status(), href).toBeLessThan(400);
  }
  for (const id of hrefs.filter((h) => h.startsWith("#")).map((h) => h.slice(1))) {
    await expect(page.locator(`#${id}`), `#${id}`).toBeAttached();
  }
});
