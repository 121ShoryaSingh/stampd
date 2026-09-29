import { test, expect } from "@playwright/test";

test("landing page renders and Start free goes to signup", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("signed");
  await page.getByRole("link", { name: /Send your first doc free/ }).click();
  await expect(page).toHaveURL(/\/signup/);
});

test("landing has no invented stats, reviews, ratings or customers", async ({ page }) => {
  await page.goto("/");
  const text = await page.locator(".lp").innerText();
  for (const fake of [/placeholder/i, /Maya Reyes|Daniel Kim|Aisha Suleiman/, /on G2|Capterra/, /12k\+/, /Northwind|Kestrel|Oakline/, /documents signed|completion rate|countries signing/, /most popular/i, /in 4 min/i]) {
    expect(text, `found ${fake}`).not.toMatch(fake);
  }
  await expect(page.getByRole("heading", { name: /Proof/ })).toBeAttached();
});

test("landing respects reduced motion", async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.locator(".lp").evaluate((el) => el.classList.contains("gsap"))).toBe(false);
});

test("the stamp ring turns but its OK stays upright", async ({ page }) => {
  await page.goto("/");
  const angle = (sel: string) =>
    page.locator(sel).evaluate((el) => {
      // Sum the rotation of the element and its ancestors, as the reader sees it.
      let deg = 0;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const m = new DOMMatrix(getComputedStyle(n).transform === "none" ? undefined : getComputedStyle(n).transform);
        deg += (Math.atan2(m.b, m.a) * 180) / Math.PI;
      }
      return deg;
    });
  await page.waitForTimeout(3500); // entrance done, ring spinning
  expect(Math.abs(await angle(".stamp .c"))).toBeLessThan(0.5);
  const a = await angle(".stamp svg");
  await page.waitForTimeout(600);
  expect(await angle(".stamp svg")).not.toBeCloseTo(a, 1);
});
