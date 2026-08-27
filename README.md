# ofplang-schedule-viewer

A static web viewer for the execution plans produced by
[`ofp-schedule`](https://github.com/ofplang/schedule), shown against the
[ofplang](https://github.com/ofplang/spec) workflow they came from.

The name says the scope: this visualises **`ofp-schedule`'s output**. Views
specific to `ofp-run` or `labcode` are not in it.

The point is to be able to hand someone a URL. They open it and see the
dataflow graph and the Gantt chart of a plan side by side, linked: pick a bar
and the workflow node it came from lights up, pick a node and every bar under
it lights up. No install, no server, no Python.

> **Status: early.** The reader and the data model are in place and tested; the
> application on top of them is not built yet. `prototype/` holds a single-file
> look-and-feel study that shows where this is going.

## Layout

| Path | What it is |
|---|---|
| `web/` | the application — Vite + TypeScript, no runtime dependency beyond `yaml` |
| `web/src/model/` | types for the workflow, the environment and the execution document |
| `web/src/read/` | YAML → those types; the only part that tracks the specifications |
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

Anything outside that subset — `$import`, generics, structured nodes — is
refused rather than guessed at.

## Working on it

```sh
git clone --recurse-submodules git@github.com:kaizu/ofplang-schedule-viewer.git
cd web
npm install

npm run dev        # development server
npm run typecheck  # tsc --noEmit
npm test           # golden tests against external/ofplang-schedule
npm run build      # typecheck + production build into web/dist
```

Already cloned without `--recurse-submodules`? `git submodule update --init`.

## License

MIT — see [LICENSE](LICENSE).
