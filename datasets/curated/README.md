# Curated datasets

Plans bundled with the viewer that the pinned `ofplang-schedule` submodule does
not ship. `web/scripts/collect-datasets.mjs` picks up every `*.plan.yaml` here
and resolves its `meta` paths against this directory, so a dataset is its
files side by side. Unlike the submodule's examples these do not follow the
pin: they change only when someone regenerates them.

## data_flow

Pure Data beside an Object, and an entry process with its own inputs and
outputs — neither of which any `ofplang-schedule` example has. A plate is
measured; the reading goes, as Pure Data, into a composite that scores it on no
device and in no time; the score both gates the step that finishes the plate
and leaves the workflow as its output.

| File | Where it comes from |
|---|---|
| `data_flow.workflow.yaml` | [`ofplang/run`](https://github.com/ofplang/run) `examples/data_flow.workflow.yaml` at `02582f0`, unchanged |
| `data_flow.env.yaml` | the same repository's `examples/data_flow.env.yaml`, unchanged |
| `data_flow.document.yaml` | written here: the entry input `sample` starts on `loader.stage`, the spot `examples/render_data_flow.py` gives it |
| `data_flow.plan.yaml` | `ofp-schedule` from [`ofplang/schedule`](https://github.com/ofplang/schedule) `v0.12.0` |

Regenerate the plan with:

```sh
ofp-schedule schedule data_flow.workflow.yaml --env data_flow.env.yaml \
  --document data_flow.document.yaml -o data_flow.plan.yaml
```
