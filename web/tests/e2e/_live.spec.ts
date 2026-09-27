import { expect, test } from "@playwright/test";

// A look at the deployed site, run by hand: `LIVE=1 npx playwright test _live`.
// Never in CI — the site is deployed only after CI passes, so a check against
// it there would wait on itself (and a first deploy would never happen).
test.skip(!process.env["LIVE"], "set LIVE=1 to check the published site");

test("the published site", async ({ page }) => {
  await page.goto("https://ofplang.github.io/export/?doc=plate_batch");
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
