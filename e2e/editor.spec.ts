import { test, expect, type Page } from "@playwright/test";
import { addRecipients, newUser, signUpWithWorkspace, startEnvelope } from "./helpers";

async function readyEditor(page: Page) {
  await signUpWithWorkspace(page, newUser("editor"));
  await startEnvelope(page, "Grid test");
  await addRecipients(page, [{ name: "Gia Grid", email: "gia@e2e.dev" }]);
  await expect(page.getByTestId("page-1").locator("canvas")).toBeVisible();
}

async function box(page: Page, name: string) {
  return (await page.getByRole("button", { name }).boundingBox())!;
}

test("fields drag freely, and the pointer and selection show coordinates in points", async ({ page }) => {
  await readyEditor(page);
  const canvas = page.getByTestId("page-1").locator("canvas");
  await canvas.waitFor();
  // Bring the page's top just under the header, clear of the wizard's sticky bottom bar.
  const top = (await canvas.boundingBox())!.y;
  await page.evaluate((dy) => window.scrollBy(0, dy), top - 120);
  const c = (await canvas.boundingBox())!;
  const s = c.width / 612;
  // Pointer at (100 pt, 200 pt) from the top-left of a Letter page.
  await page.mouse.move(c.x + 100 * s, c.y + 200 * s);
  await expect(page.getByTestId("pointer-coords")).toHaveText(/p1\s+(99|100|101), (199|200|201)/);

  await page.getByRole("button", { name: "Signature" }).click();
  await page.getByRole("button", { name: "Place at center" }).click();
  const field = page.getByRole("button", { name: "signature field" });
  const before = (await field.boundingBox())!;
  // A 7-pixel drag moves the field 7 pixels: no jump to the next grid column.
  await page.mouse.move(before.x + 20, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + 27, before.y + 10, { steps: 7 });
  await page.mouse.up();
  const after = (await field.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(7, 0);

  // Typing a position puts the field exactly there.
  await page.getByLabel("Field X in points").fill("72");
  await page.getByLabel("Field Y in points").fill("144");
  await expect(page.getByLabel("Field Y in points")).toHaveValue("144");
  const placed = (await field.boundingBox())!;
  const now = (await canvas.boundingBox())!; // the page may have scrolled
  expect(placed.x - now.x).toBeCloseTo(72 * s, 0);
  expect(placed.y - now.y).toBeCloseTo(144 * s, 0);
});

test("drag a field from the palette, snap it, nudge it and delete it", async ({ page }) => {
  await readyEditor(page);
  // Dragging is free by default; snapping is opt-in.
  await expect(page.getByLabel("Snap to grid")).not.toBeChecked();
  await page.getByLabel("Snap to grid").check();
  // The sidebar scrolls on its own; bring the palette back into view.
  await page.getByRole("button", { name: "Date" }).scrollIntoViewIfNeeded();
  await page.getByTestId("page-1").scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  const target = (await page.getByTestId("page-1").boundingBox())!;
  const src = await box(page, "Date");
  const view = page.viewportSize()!;
  // Somewhere on the page, clear of the sticky header and the wizard's bottom bar.
  const dropY = Math.min(Math.max(target.y + 400, 160), view.height - 180);

  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 300, dropY, { steps: 12 });
  await page.mouse.up();

  const field = page.getByRole("button", { name: "date field" });
  await expect(field).toBeVisible();
  // At 100% the finest grid cell is half a 1/80-page step (about 5 px).
  const cell = 760 * 0.00625;
  const before = (await field.boundingBox())!;
  // Snapped: the left edge sits on a grid line (measured from the page itself, inside its border).
  const inner = (await page.getByTestId("page-1").locator("canvas").boundingBox())!;
  const offset = (before.x - inner.x) / cell;
  expect(Math.abs(offset - Math.round(offset))).toBeLessThan(0.3);

  await field.focus();
  await page.keyboard.press("ArrowRight");
  const after = (await field.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(cell, 0);

  await page.keyboard.press("Delete");
  await expect(field).toHaveCount(0);
});

test("a click on a palette item still picks the click-to-place tool", async ({ page }) => {
  await readyEditor(page);
  await page.getByRole("button", { name: "Signature" }).click();
  await expect(page.getByRole("button", { name: "Signature" })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("page-1").locator("canvas").click({ position: { x: 300, y: 300 } });
  await expect(page.getByRole("button", { name: "signature field" })).toBeVisible();
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved 1 fields" })).toBeVisible();
});

test("keyboard placement, zoom and unsaved indicator", async ({ page }) => {
  await readyEditor(page);
  await page.getByRole("button", { name: "Text" }).click();
  await page.getByRole("button", { name: "Place at center" }).click();
  await expect(page.getByRole("button", { name: "text field" })).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const before = (await page.getByTestId("page-1").boundingBox())!.width;
  await page.getByLabel("Zoom").selectOption("125");
  const after = (await page.getByTestId("page-1").boundingBox())!.width;
  expect(after / before).toBeGreaterThan(1.2);

  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("recipients can be reordered with buttons, and the order is kept", async ({ page }) => {
  await signUpWithWorkspace(page, newUser("order"));
  await startEnvelope(page, "Order test");
  await page.getByLabel("Recipient 1 name").fill("Amy First");
  await page.getByLabel("Recipient 1 email").fill("amy@e2e.dev");
  await page.getByRole("button", { name: "Add recipient" }).click();
  await page.getByLabel("Recipient 2 name").fill("Zed Last");
  await page.getByLabel("Recipient 2 email").fill("zed@e2e.dev");
  await page.getByRole("button", { name: "Move recipient 2 up" }).click();
  await expect(page.getByLabel("Recipient 1 name")).toHaveValue("Zed Last");
  await expect(page.getByLabel("Recipient 1 order")).toHaveValue("1");
  await expect(page.getByLabel("Recipient 2 order")).toHaveValue("2");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/fields$/);
  // Back to the recipients step: saved, in the new order.
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/recipients$/);
  await expect(page.getByLabel("Recipient 1 name")).toHaveValue("Zed Last");
  await expect(page.getByLabel("Recipient 2 name")).toHaveValue("Amy First");
});
