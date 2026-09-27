# ofplang-schedule-viewer

A static web viewer for the execution plans produced by
[`ofp-schedule`](https://github.com/ofplang/schedule), shown against the
[ofplang](https://github.com/ofplang/spec) workflow they came from.

The name says the scope: this visualises **`ofp-schedule`'s output**. Views
specific to `ofp-run` or `labcode` are not in it.

**→ [kaizu.github.io/ofplang-schedule-viewer](https://kaizu.github.io/ofplang-schedule-viewer/)**
— ten plans are bundled; `?doc=plate_batch` opens one directly. Drop your own
YAML on the window to read that instead: a plan, a workflow, an environment, or
all three at once. A workflow on its own is fine — the graph does not need a
plan to be read. Either pane can take the whole window: *Both / Workflow / Plan*
in the top bar, or `&layout=workflow` / `&layout=plan` in the address.

The point is to be able to hand someone a URL. They open it and see the
dataflow graph and the Gantt chart of a plan side by side, linked: pick a bar
and the workflow node it came from lights up, pick a node and every bar under
it lights up. No install, no server, no Python.

> **Status: early but usable.** Both panes work and are linked: pick a bar and
> the workflow box it came from lights up, pick a box and everything under it
> lights up in the plan. Plans can be exported as SVG or put in a link.
> `prototype/` holds the single-file look-and-feel study the visual decisions
> were made against.

## A single file

The same viewer also builds as **one self-contained HTML file** that carries
its documents inside it: open it from disk, no server, nothing beside it.
`npm run build:single` writes the empty template, `web/dist-single/viewer.html`
(also kept as the `viewer-template` artifact of every CI run), and
`web/scripts/embed.mjs` puts documents into it:

```sh
node scripts/embed.mjs dist-single/viewer.html out.html plan.yaml --workflow w.yaml --env e.yaml
```

The documents go in as the YAML text as written, in one element —
`<script type="application/json" id="ofp-documents" data-contract="1">` — and
the page reads them with the same reader it uses for a dropped file. An empty
template (`null` in that element) is an offline viewer to drop files on. The
web fonts stay a link, so offline the page falls back to system fonts; *Copy
link* is hidden, since a link made from a file on disk would point at the disk.

## Layout

| Path | What it is |
|---|---|
| `web/` | the application — Vite + TypeScript, no runtime dependency beyond `yaml` |
| `web/src/model/` | types for the workflow, the environment and the execution document |
| `web/src/read/` | YAML → those types; the only part that tracks the specifications |
| `web/src/model/scene.ts` | the indices every view is built on — by node, by arc, by machine |
| `web/src/layout/` | lanes, bars and the time scale; pure functions, no DOM |
| `web/src/view/` | SVG rendering, the inspector, and the SVG export |
| `web/scripts/collect-datasets.mjs` | turns the submodule's examples into the bundled datasets |
| `web/scripts/build-single.mjs` | folds the build into the one-file viewer template |
| `web/scripts/embed.mjs` | puts documents into that template — the contract, in one place |
| `web/tests/golden/` | every example the pinned submodule ships must read |
| `external/ofplang-schedule` | submodule, pinned by tag — specifications and examples |
| `prototype/` | a single-file look-and-feel study; not the codebase |

## Why a TypeScript reader instead of reusing the Python one

The sibling repositories own the specifications and the semantics, and this one
does not modify them. It also has to run with nothing installed on the viewer's
machine, which rules out a Python pre-processing step. So the document readers
here are a deliberate, bounded re-implementation of two stable schemas —
`SPECIFICATIONS.md` §5 (environment) and §6 (execution document) — kept honest
by the golden test against the pinned submodule's own examples.

Anything outside that subset — `$import`, generics, structured nodes, and
joint plans that schedule several workflows together as jobs — is refused
rather than guessed at.

## Working on it

```sh
git clone --recurse-submodules git@github.com:kaizu/ofplang-schedule-viewer.git
cd web
npm install

npm run dev        # development server (collects the datasets first)
npm run datasets   # rebuild public/datasets/ from external/
npm run typecheck  # tsc --noEmit
npm test           # golden tests against external/ofplang-schedule
npm run build      # typecheck + production build into web/dist
npm run build:single  # …and the one-file template into web/dist-single
npm run test:e2e   # the browser tests (builds the template first)
```

Already cloned without `--recurse-submodules`? `git submodule update --init`.

## License

MIT — see [LICENSE](LICENSE).
