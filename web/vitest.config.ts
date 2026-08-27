import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Playwright specs live under tests/e2e and are run by Playwright.
    exclude: ["node_modules/**", "dist/**", "tests/e2e/**"],
  },
});
