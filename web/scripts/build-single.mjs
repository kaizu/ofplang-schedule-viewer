/**
 * Fold the Pages build into one self-contained HTML file — the viewer
 * template (design.md D2 / D48).
 *
 * Runs after `vite build`. The script and the stylesheet are inlined, the
 * bundled datasets are left out (a single file shows the documents put in
 * it, see `embed.mjs`), and an empty `#ofp-documents` element is added for
 * those documents to go into. The web fonts stay a link: offline the page
 * falls back to the system faces rather than growing by the font files.
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CONTRACT } from "./embed.mjs";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const DIST = here("../dist/");
const OUT = here("../dist-single/");
// The Python package carries the same file (design.md D50); ignored by git.
const PACKAGE = here("../../ofplang/export/_template/");

let html = readFileSync(`${DIST}index.html`, "utf8");

const inline = (pattern, wrap) => {
  const m = pattern.exec(html);
  if (!m) throw new Error(`build-single: nothing matched ${pattern}`);
  const body = readFileSync(`${DIST}${m[1]}`, "utf8");
  html = html.replace(m[0], () => wrap(body));
};

// Inside a <script>, "</script" ends the element whatever it sits in, and
// "<!--" can change how the rest is parsed. Both escapes mean the same thing
// to JavaScript in a string, a regex or a comment.
const scriptSafe = (js) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

inline(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, (js) =>
  `<script type="module">${scriptSafe(js)}</script>`,
);
// The PNG icon sits beside the site; a single file has nothing beside it,
// and keeps only the inline SVG one.
html = html.replace(/\s*<link rel="icon" type="image\/png"[^>]*data-site-only[^>]*>/, "");

inline(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, (css) =>
  `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`,
);

let build = process.env["GITHUB_SHA"]?.slice(0, 7);
try {
  build ??= execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  build ??= "unknown";
}

html = html.replace(
  "</head>",
  () =>
    `    <meta name="ofp-viewer-build" content="${build}" />\n` +
    `    <script type="application/json" id="ofp-documents" data-contract="${CONTRACT}">null</script>\n  </head>`,
);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}viewer.html`, html);
mkdirSync(PACKAGE, { recursive: true });
writeFileSync(`${PACKAGE}viewer.html`, html);
console.log(`build-single: dist-single/viewer.html (${Math.round(html.length / 1024)} KB, build ${build})`);
