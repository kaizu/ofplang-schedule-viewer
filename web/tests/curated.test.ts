/**
 * The curated datasets (datasets/curated/) — plans bundled here that the pinned
 * submodule does not ship, so the golden tests never see them.
 *
 * Each must read, find its own workflow and environment through `meta`, and
 * join: every activity's node path has to land on a box of that workflow.
 * data_flow is also held to the reason it is bundled — Pure Data arcs and an
 * entry with its own inputs and outputs.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildGraph, compositeKeys, findNode } from "../src/model/graph";
import { buildScene } from "../src/model/scene";
import { layoutGraph } from "../src/layout/graph";
import { readEnvironmentText, readExecutionDocumentText, readWorkflowText } from "../src/read";

const CURATED = fileURLToPath(new URL("../../datasets/curated/", import.meta.url));
const text = (name: string): string => readFileSync(join(CURATED, name), "utf8");
const plans = readdirSync(CURATED).filter((f) => f.endsWith(".plan.yaml"));

it("there is something curated", () => {
  expect(plans.length).toBeGreaterThan(0);
});

for (const file of plans)
  describe(file, () => {
    const doc = readExecutionDocumentText(text(file));
    const wf = readWorkflowText(text(doc.meta!.workflow!));
    const env = readEnvironmentText(text(doc.meta!.environment!));
    const scene = buildScene(doc, env, wf);
    const graph = buildGraph(wf);

    it("names its workflow and environment in meta, beside it", () => {
      expect(doc.meta?.workflow).toBeTruthy();
      expect(doc.meta?.environment).toBeTruthy();
    });

    it("joins: every activity lands on a node of its workflow", () => {
      for (const a of scene.activities) {
        if (a.kind === "processing") expect(findNode(graph, a.node.join(".")), a.node.join(".")).toBeDefined();
        if (a.kind === "transport" || a.kind === "relay")
          for (const end of [a.arc.from, a.arc.to])
            expect(findNode(graph, end.node.join(".")), end.node.join(".")).toBeDefined();
      }
    });
  });

describe("data_flow — why it is bundled", () => {
  const wf = readWorkflowText(text("data_flow.workflow.yaml"));
  const graph = buildGraph(wf);
  const { edges } = layoutGraph(graph, new Set(compositeKeys(graph)));

  it("has an entry with its own inputs and outputs", () => {
    expect(graph.inputs).toEqual(["sample"]);
    expect(graph.outputs).toEqual(["final_score"]);
    expect(graph.inputTypes).toEqual({ sample: "Plate" });
    expect(graph.outputTypes).toEqual({ final_score: "Score" });
  });

  it("draws its Pure Data arcs — the `bind` bindings — beside the Object ones", () => {
    const data = edges.filter((e) => !e.object).map((e) => `${e.fromKey}.${e.fromPort}->${e.toKey}.${e.toPort}`);
    expect(data.sort()).toEqual(
      [
        "Measure.reading->Az.a_reading",
        "Az.a_reading->Az.A.reading",
        "Az.A.score->Az.a_score",
        "Az.a_score->Finish.go",
        "Az.a_score->.final_score",
      ].sort(),
    );
    expect(edges.filter((e) => e.object)).toHaveLength(2);
  });

  it("puts the device-less step on no device", () => {
    const doc = readExecutionDocumentText(text("data_flow.plan.yaml"));
    const analyze = doc.activities.find((a) => a.kind === "processing" && a.process === "analyze");
    expect(analyze && analyze.kind === "processing" && analyze.devices).toBeFalsy();
  });
});
