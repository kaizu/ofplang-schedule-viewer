/**
 * The details pane, hidden and shown (design.md D70).
 *
 * The pane that describes the selection is worth its column on a wide screen
 * and folds away on a narrow one. An artifact beside a conversation is wide
 * enough to keep it and too narrow to spare it, so the person sets it with a
 * button, and a written page may start without it.
 */

import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, doc: string): Promise<void> => {
  await page.goto(`/?doc=${doc}`);
  await expect(page.locator("#plot rect.bar").first()).toBeVisible();
};
const aside = (page: Page) => page.locator("aside");
const planWidth = (page: Page) => page.locator("#plan-pane").evaluate((e) => e.getBoundingClientRect().width);

test("wide: shown until hidden, and the panes take its room", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "storage");
  const button = page.locator("#details");
  await expect(aside(page)).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const before = await planWidth(page);

  await button.click();
  await expect(aside(page)).toBeHidden();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await planWidth(page)).toBeGreaterThan(before + 200);

  await button.click();
  await expect(aside(page)).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "true");
});

test("narrow: folded away until asked for", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await open(page, "storage");
  await expect(aside(page)).toBeHidden();
  await expect(page.locator("#details")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#details").click();
  await expect(aside(page)).toBeVisible();
});

test("the chart is redrawn to the room it gets", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "storage");
  const plot = () => page.locator("#plot").evaluate((e) => Number(e.getAttribute("width")));
  const before = await plot();
  await page.locator("#details").click();
  await expect.poll(plot).toBeGreaterThan(before + 200);
});
