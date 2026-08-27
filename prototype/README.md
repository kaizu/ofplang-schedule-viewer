# prototype

A single-file look-and-feel study, written 2026-08-27 before the real
application existed. Open `index.html` in a browser — no build, no install.

It is **not** the codebase. Its layout code was written for the study rather
than ported from `ofp-schedule visualize`, and it reads YAML-derived JSON that
was baked in ahead of time rather than parsed by `web/src/read`. The real
application lives in `web/`.

`index.template.html` is the source; `index.html` is that file with the example
data substituted for the `__DATASETS__` placeholder.

Kept because it is what the visual decisions were made against.
