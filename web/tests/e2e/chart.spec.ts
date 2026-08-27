/**
 * What the browser does with the chart.
 *
 * Every assertion here is about geometry, because geometry is the part the
 * unit tests are blind to. The clipping bug that prompted these was invisible
 * to them: the SVG was correct and the CSS threw half of it away.
 */

import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, doc: string): Promise<void> => {
  await page.goto(`/?doc=${doc}`);
  await expect(page.locator("#plot rect.bar").first()).toBeVisible();
};

const pickView = async (page: Page, view: string): Promise<void> => {
  await page.locator(`#views button[data-view="${view}"]`).click();
  await expect(page.locator(`#views button[data-view="${view}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
};

test.describe("a tall chart", () => {
  // 44 activities, so the activity view is far taller than the window.
  test.beforeEach(async ({ page }) => {
    await open(page, "plate_batch");
    await pickView(page, "activity");
  });

  test("gives every activity a lane, and a bar on it", async ({ page }) => {
    const lanes = await page.locator("#gutter text.lane-label").count();
    const bars = await page.locator("#plot rect.bar").count();
    expect(lanes).toBe(44);
    expect(bars).toBe(44);
  });

  test("is as tall as its gutter — nothing is clipped away", async ({ page }) => {
    const gutter = await page.locator("#gutter").boundingBox();
    const plot = await page.locator("#plot").boundingBox();
    expect(gutter).not.toBeNull();
    expect(plot).not.toBeNull();
    expect(Math.abs(plot!.height - gutter!.height)).toBeLessThan(2);
    expect(plot!.height).toBeGreaterThan(1000);
  });

  test("scrolls all the way to the last activity", async ({ page }) => {
    const row = page.locator("#body-row");
    await row.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));

    const last = page.locator("#plot rect.bar").last();
    await expect(last).toBeInViewport();

    // In view of the window is not enough — it has to be inside the scrolling
    // box, which is what the clip made impossible.
    const rowBox = (await row.boundingBox())!;
    const barBox = (await last.boundingBox())!;
    expect(barBox.y).toBeGreaterThanOrEqual(rowBox.y - 1);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
  });

  test("keeps the lane labels in place while the plot scrolls sideways", async ({ page }) => {
    await page.locator("#zoom-in").click();
    await page.locator("#zoom-in").click();

    const row = page.locator("#body-row");
    const before = (await page.locator("#gutter").boundingBox())!;
    await row.evaluate((el) => el.scrollTo({ left: 400 }));
    await expect(page.locator("#gutter")).toBeVisible();
    const after = (await page.locator("#gutter").boundingBox())!;

    expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    // And the axis followed the plot, so the ticks still line up.
    const axisLeft = await page.locator("#axis-scroll").evaluate((el) => el.scrollLeft);
    const rowLeft = await row.evaluate((el) => el.scrollLeft);
    expect(Math.round(axisLeft)).toBe(Math.round(rowLeft));
  });
});

const pageOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("the page never scrolls sideways as a whole", () => {
  for (const view of ["device", "flow", "activity"]) {
    test(`in the ${view} view`, async ({ page }) => {
      await open(page, "plate_batch");
      await pickView(page, view);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("even zoomed in, where a wide plot could force the pane open", async ({ page }) => {
    await open(page, "plate_batch");
    const paneBefore = (await page.locator(".pane-hd").boundingBox())!.width;

    for (let i = 0; i < 4; i++) await page.locator("#zoom-in").click();

    // The chart scrolls; the page around it does not move, and the toolbar
    // stays where it was rather than sliding under the inspector.
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    const paneAfter = (await page.locator(".pane-hd").boundingBox())!.width;
    expect(paneAfter).toBe(paneBefore);
    await expect(page.locator("#zoom-in")).toBeInViewport();

    const row = page.locator("#body-row");
    expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  });
});

test.describe("selection", () => {
  test("lights the whole journey of a multi-hop move", async ({ page }) => {
    await open(page, "reroute_chain_replan");
    await pickView(page, "flow");

    await page.locator("#plot rect.bar.transport").first().click();

    // Three legs and the two relays between them: the arc is the whole journey,
    // and the inspector counts it the same way.
    await expect(page.locator("#plot rect.bar.lit")).toHaveCount(5);
    await expect(page.locator("#plot rect.bar.relay.lit")).toHaveCount(2);
    await expect(page.locator("#inspector")).toContainText("legs");
    expect(await page.locator("#plot rect.bar.dim").count()).toBeGreaterThan(0);
  });

  test("tells you what you picked, and lets you put it down", async ({ page }) => {
    await open(page, "plate_batch");
    await page.locator("#plot rect.bar.processing").first().click();

    await expect(page.locator("#inspector")).toContainText("processing");
    await expect(page.locator("#status-selection")).toContainText("Selected");

    await page.keyboard.press("Escape");
    await expect(page.locator("#status-selection")).toContainText("Nothing selected");
    await expect(page.locator("#plot rect.bar.lit")).toHaveCount(0);
  });
});

test.describe("a replan", () => {
  test("draws the now marker and dims what already finished", async ({ page }) => {
    await open(page, "simple_replan");
    await expect(page.locator("#plot line.nowline")).toHaveCount(1);
    await expect(page.locator("#axis text.nowcap")).toHaveText("now");
    expect(await page.locator("#plot rect.bar.done").count()).toBeGreaterThan(0);
  });
});

test.describe("both themes", () => {
  for (const theme of ["light", "dark"]) {
    test(`${theme}: the page paints its own ground and its text reads on it`, async ({ page }) => {
      await open(page, "reformatter");
      await page.locator("#theme").selectOption(theme);

      const { bg, fg } = await page.evaluate(() => {
        const s = getComputedStyle(document.body);
        return { bg: s.backgroundColor, fg: s.color };
      });
      // Not transparent — a transparent body borrows whatever is behind it.
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
      expect(bg).not.toBe(fg);

      const luminance = (c: string): number => {
        const [r, g, b] = c.match(/\d+/g)!.map(Number) as [number, number, number];
        const f = (v: number): number => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const [hi, lo] = [luminance(bg), luminance(fg)].sort((a, b) => b - a) as [number, number];
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThan(7);
    });
  }
});

test.describe("bundled plans", () => {
  test("the picker lists them and the URL follows the choice", async ({ page }) => {
    await page.goto("/");
    const options = page.locator("#dataset option");
    expect(await options.count()).toBeGreaterThanOrEqual(8);

    await page.locator("#dataset").selectOption("two_arms");
    // The previous plan's bars are still on screen while the next one loads,
    // so wait for the thing that actually changes.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("doc"))
      .toBe("two_arms");
    await expect(page.locator("#ro-outcome")).toHaveText("optimal");
    await expect(page.locator("#ro-count")).toHaveText("6");
  });

  test("nothing in the corpus trips the feature gate", async ({ page }) => {
    await page.goto("/");
    for (const id of ["simple", "two_arms", "reformatter", "plate_batch"]) {
      await page.locator("#dataset").selectOption(id);
      await expect(page.locator("#plot rect.bar").first()).toBeVisible();
      await expect(page.locator("#banner")).toBeHidden();
    }
  });
});
