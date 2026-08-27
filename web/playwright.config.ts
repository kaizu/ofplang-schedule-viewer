import { defineConfig } from "@playwright/test";

const CI = !!process.env["CI"];
const PORT = 5175;
const URL = `http://127.0.0.1:${PORT}`;

/**
 * Layout is the one thing the unit tests cannot see: they read the SVG this
 * code emits, and the emitted markup has been right every time something went
 * wrong on screen. These run the real thing in a real engine.
 *
 * Deliberately no pixel snapshots — font rasterisation differs between this
 * machine and the Linux runner, so they would fail for reasons that are not
 * bugs. What is asserted instead is geometry: what is visible, what is
 * reachable, what stays put.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 1 : undefined,
  reporter: CI ? "line" : "list",
  use: {
    baseURL: URL,
    // Only the headless shell is installed (`playwright install chromium --only-shell`).
    channel: "chromium-headless-shell",
    viewport: { width: 1440, height: 900 },
    trace: CI ? "retain-on-failure" : "off",
  },
  webServer: {
    // Vite directly rather than through `npm run dev --`: npm's argument
    // forwarding does not survive the trip on Windows, and the server ends up
    // on its default port where Playwright never finds it.
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: URL,
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
