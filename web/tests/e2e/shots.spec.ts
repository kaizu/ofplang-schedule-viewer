/**
 * Screenshots, so the person writing this can look at it.
 *
 * Not assertions — `npm run shots` writes PNGs into `web/shots/` and that is
 * the whole point. There is no browser in the environment this is developed
 * in, and two layout bugs shipped because of it.
 */

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { test, type Page } from "@playwright/test";

const DIR = fileURLToPath(new URL("../../shots/", import.meta.url));
mkdirSync(DIR, { recursive: true });

const shot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: `${DIR}${name}.png`, fullPage: false });
};

const settle = async (page: Page): Promise<void> => {
  await page.locator("#plot rect.bar").first().waitFor();
  // Give the webfont a moment; a fallback-rendered shot is still readable but
  // the spacing is not what a viewer sees.
  await page.evaluate(() => document.fonts.ready);
};

test.describe.configure({ mode: "serial" });

test("the plans, in both themes", async ({ page }) => {
  for (const doc of ["simple", "two_arms", "reformatter", "plate_batch"]) {
    await page.goto(`/?doc=${doc}`);
    await settle(page);
    for (const theme of ["light", "dark"]) {
      await page.locator("#theme").selectOption(theme);
      await shot(page, `${doc}.device.${theme}`);
    }
  }
});

test("the three views of the big one", async ({ page }) => {
  await page.goto("/?doc=plate_batch");
  await settle(page);
  for (const view of ["device", "flow", "activity"]) {
    await page.locator(`#views button[data-view="${view}"]`).click();
    await shot(page, `plate_batch.${view}`);
  }
});

test("the workflow graph, and the link between the panes", async ({ page }) => {
  await page.goto("/?doc=plate_batch");
  await settle(page);
  await shot(page, "graph.collapsed");

  await page.locator('#graph [data-key="b2"] .btext').click();
  await shot(page, "graph.one-branch-open");

  await page.locator("#expand-all").click();
  await shot(page, "graph.expanded");

  await page.locator("#collapse-all").click();
  await page.locator("#plot rect.bar.processing").nth(6).click();
  await shot(page, "linked.bar-to-box");

  await page.locator('#graph [data-key="b1"] rect.box').click();
  await shot(page, "linked.box-to-bars");
});

test("the graph of a wide fan-out", async ({ page }) => {
  await page.goto("/?doc=reformatter");
  await settle(page);
  await shot(page, "graph.reformatter");
});

test("a replan, and a selection", async ({ page }) => {
  await page.goto("/?doc=simple_replan");
  await settle(page);
  await shot(page, "replan.now-marker");

  await page.goto("/?doc=reroute_chain_replan");
  await settle(page);
  await page.locator(`#views button[data-view="flow"]`).click();
  await page.locator("#plot rect.bar.transport").first().click();
  await shot(page, "selection.multi-leg");
});

test("the feature gate, refusing something it cannot draw", async ({ page }) => {
  await page.goto("/?doc=plate_batch");
  await settle(page);
  // Nothing in the corpus trips it, so the banner is staged here rather than
  // waited for — this shot exists to check that it reads well, not that it fires.
  await page.evaluate(() => {
    const banner = document.getElementById("banner")!;
    banner.innerHTML =
      "<div><b>This viewer cannot draw a structured node (`kind: map`) faithfully, so parts of the graph are left out.</b>" +
      "<ul><li>a structured node (`kind: map`) at <code>processes.main.body.nodes[3]</code> — the viewer draws source structure only and cannot show what this expands to (§17-§20)</li></ul></div>";
    banner.hidden = false;
  });
  await shot(page, "gate.banner");
});
