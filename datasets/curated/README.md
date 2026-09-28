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

## plate_assay

A plate assay, ELISA-like, written here to show in one plan what the smaller
examples show one at a time. Three sample tubes and a plate of standards are
pipetted onto a fresh assay plate; the plate is sealed, incubated, washed,
given the detection reagent, incubated again and read; the reading is analysed
into concentrations on no device. So there are five Objects of two types, each
with its own fate — the tubes and the standards arrive as entry inputs and are
discarded part-way, the assay plate is created inside and returned — and Pure
Data beside them, returned as the workflow's second output. Two composites
(`add_sample`, used three times, and `develop`), two arms that move at once,
literal parameters, and an incubator that holds the plate while the machine
stays free (`device_access: false`).

| File | Where it comes from |
|---|---|
| `plate_assay.workflow.yaml` | written here; `ofp-validate` (ofplang-validate `v0.2.2`) finds it valid |
| `plate_assay.env.yaml` | written here; the durations are plausible, not measured |
| `plate_assay.document.yaml` | written here: where the tubes and the standards start, and where the finished plate goes |
| `plate_assay.plan.yaml` | `ofp-schedule` from [`ofplang/schedule`](https://github.com/ofplang/schedule) `v0.12.0`: optimal, makespan 118 min, 35 activities, a few seconds |

Regenerate the plan with (`--seed` alone does not reproduce a plan; the hash
seed has to be fixed too):

```sh
PYTHONHASHSEED=0 ofp-schedule schedule plate_assay.workflow.yaml --env plate_assay.env.yaml   --document plate_assay.document.yaml --seed 0 -o plate_assay.plan.yaml
```
