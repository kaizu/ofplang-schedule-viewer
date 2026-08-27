import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built site works from a GitHub Pages sub-path and
  // from a plain file:// open alike (design.md D21).
  base: "./",
  server: {
    // The pinned submodule sits above this package; `?raw` imports of the
    // example documents need it on the allow-list (design.md D20).
    fs: { allow: [".."] },
  },
});
