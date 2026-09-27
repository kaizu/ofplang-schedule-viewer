/**
 * What the page calls itself (design.md D55): OFP View, after the documents
 * open in it, with the ofplang mark as its icon.
 */

import { expect, test } from "@playwright/test";

test("the tab names the open plan, then the page", async ({ page }) => {
  await page.goto("/?doc=plate_batch");
  await expect(page.locator("#plot rect.bar").first()).toBeVisible();
  await expect(page).toHaveTitle("Plate batch — OFP View");
  await expect(page.locator(".wordmark")).toContainText("OFP View");

  await page.locator("#dataset").selectOption("data_flow");
  await expect(page).toHaveTitle("Data flow — OFP View");
});

test("carries the ofplang mark as its icon, inline", async ({ page }) => {
  await page.goto("/?doc=simple");
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(icon).toHaveCount(1);
  expect(await icon.getAttribute("href")).toMatch(/^data:image\/svg\+xml,/);
  // The mark decodes to an image the browser can draw.
  const drawn = await page.evaluate(async (href) => {
    const img = new Image();
    img.src = href!;
    await img.decode();
    return img.naturalWidth > 0;
  }, await icon.getAttribute("href"));
  expect(drawn).toBe(true);
});
