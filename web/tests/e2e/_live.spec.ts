import { expect, test } from "@playwright/test";

test("the published site", async ({ page }) => {
  await page.goto("https://kaizu.github.io/ofplang-schedule-viewer/?doc=plate_batch");
  await expect(page.locator("#plot rect.bar").first()).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  console.log(
    "bars:", await page.locator("#plot rect.bar").count(),
    "| boxes:", await page.locator("#graph g.gnode").count(),
    "| makespan:", await page.locator("#ro-makespan").textContent(),
    "| url:", page.url(),
  );
  await page.locator('#graph [data-key="b2"] rect.box').click();
  console.log("lit bars after selecting b2:", await page.locator("#plot rect.bar.lit").count());
  await page.screenshot({ path: "shots/_live.png" });
});
