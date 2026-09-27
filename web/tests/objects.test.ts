/**
 * Object behaviour of atomic processes (workflow spec §14, §15).
 *
 * The golden half is the premise of the Object view (design.md D57): every
 * Object-bearing port of every bundled atomic process has a fate once the
 * `object_identity_map` marker is taken into account. Without the marker
 * plate_batch's middle steps have none, and each of its plates would fall
 * apart into one Object per move.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { carriesObject } from "../src/model/graph";
import { objectsOf } from "../src/model/objects";
import type { AtomicProcess, Workflow } from "../src/model/workflow";
import { readWorkflowText } from "../src/read";
import { read, workflowFiles } from "./golden/corpus";

const atomic = (yaml: string): { wf: Workflow; def: AtomicProcess } => {
  const wf = readWorkflowText(yaml);
  const def = wf.processes["p"];
  if (def?.kind !== "atomic") throw new Error("test workflow has no atomic p");
  return { wf, def };
};

const HEADER = `
spec_version: "0.0"
types: { Plate: { domain: object }, Tube: { domain: object } }
entry: main
`;
const MAIN = `
  main: { kind: composite, body: { nodes: [{ id: n, process: p }] } }
`;

describe("objectsOf", () => {
  it("takes a written objects section as it stands", () => {
    const { wf, def } = atomic(`${HEADER}
processes:
  p:
    kind: atomic
    behavior: [object_identity_map]
    inputs: { plate: { type: Plate, phase: data } }
    outputs: { plate: { type: Plate, phase: data } }
    objects: { consume: [inputs.plate], create: [outputs.plate] }
${MAIN}`);
    expect(def.behavior).toEqual(["object_identity_map"]);
    expect(objectsOf(def, wf)).toEqual({ consume: ["inputs.plate"], create: ["outputs.plate"] });
  });

  it("infers a map from the marker where objects is omitted", () => {
    const { wf, def } = atomic(`${HEADER}
processes:
  p:
    kind: atomic
    behavior: [object_identity_map]
    inputs:
      a: { type: Plate, phase: data }
      b: { type: Plate, phase: data }
      reading: { type: Float, phase: data }
    outputs:
      a: { type: Plate, phase: data }
      b: { type: Plate, phase: data }
      reading: { type: Float, phase: data }
${MAIN}`);
    // Pure Data has no slots (§14), so `reading` is not mapped.
    expect(objectsOf(def, wf)).toEqual({ map: { "outputs.a": "inputs.a", "outputs.b": "inputs.b" } });
  });

  it("pairs only the same name, type and phase", () => {
    const { wf, def } = atomic(`${HEADER}
processes:
  p:
    kind: atomic
    behavior: [object_identity_map]
    inputs:
      same: { type: Plate, phase: data }
      retyped: { type: Plate, phase: data }
      rephased: { type: Plate, phase: data }
      unpaired: { type: Plate, phase: data }
    outputs:
      same: { type: Plate, phase: data }
      retyped: { type: Tube, phase: data }
      rephased: { type: Plate, phase: done }
      other: { type: Plate, phase: data }
${MAIN}`);
    expect(objectsOf(def, wf)).toEqual({ map: { "outputs.same": "inputs.same" } });
  });

  it("gives nothing without either", () => {
    const { wf, def } = atomic(`${HEADER}
processes:
  p:
    kind: atomic
    inputs: { plate: { type: Plate, phase: data } }
${MAIN}`);
    expect(def.behavior).toBeUndefined();
    expect(objectsOf(def, wf)).toEqual({});
  });
});

const CURATED = fileURLToPath(new URL("../../datasets/curated/", import.meta.url));
const bundled: [string, string][] = [
  ...workflowFiles.map(([dir, name]) => [name, read(dir, name)] as [string, string]),
  ...readdirSync(CURATED)
    .filter((f) => f.endsWith(".workflow.yaml"))
    .map((f) => [f, readFileSync(join(CURATED, f), "utf8")] as [string, string]),
];

describe("every bundled Object-bearing port has a fate", () => {
  for (const [name, text] of bundled)
    it(name, () => {
      const wf = readWorkflowText(text);
      const unaccounted: string[] = [];
      for (const [pname, def] of Object.entries(wf.processes)) {
        if (def.kind !== "atomic") continue;
        const o = objectsOf(def, wf);
        const ended = new Set([...(o.consume ?? []), ...Object.values(o.map ?? {})]);
        const begun = new Set([...(o.create ?? []), ...Object.keys(o.map ?? {})]);
        for (const [port, d] of Object.entries(def.inputs))
          if (carriesObject(d.type, wf) && !ended.has(`inputs.${port}`)) unaccounted.push(`${pname}.inputs.${port}`);
        for (const [port, d] of Object.entries(def.outputs))
          if (carriesObject(d.type, wf) && !begun.has(`outputs.${port}`)) unaccounted.push(`${pname}.outputs.${port}`);
      }
      expect(unaccounted).toEqual([]);
    });
});
