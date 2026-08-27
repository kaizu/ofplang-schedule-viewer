/**
 * Golden test — every workflow the pinned submodule ships must read, and must
 * pass the feature gate.
 *
 * The gate assertion is the load-bearing one. It says the corpus stays inside
 * the subset this viewer draws; the day an example starts using `$import`, a
 * generic or a structured node, raising the pin turns this red and the gate
 * (design.md D10) has to earn its keep for real.
 */

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { gateSummary, gateWorkflow, readWorkflowText } from "../../src/read";
import { read, workflowFiles } from "./corpus";

it("the pinned submodule ships workflows", () => {
  expect(workflowFiles.length).toBeGreaterThanOrEqual(5);
});

for (const [dir, name] of workflowFiles)
  describe(name, () => {
    const text = read(dir, name);
    const wf = readWorkflowText(text);

    it("reads, and its entry resolves to a declared process", () => {
      expect(wf.entry).not.toBe("");
      expect(wf.processes[wf.entry]).toBeDefined();
    });

    it("passes the feature gate", () => {
      // The gate takes the raw parsed document, not the model — it has to see
      // the keys the model deliberately drops.
      const report = gateWorkflow(parseYaml(text));
      expect(gateSummary(report)).toBe("");
      expect(report.supported).toBe(true);
      expect(report.needsExpansion).toBe(false);
      expect(report.derived).toEqual([]);
    });

    it("every node invokes a declared process", () => {
      for (const [pname, def] of Object.entries(wf.processes)) {
        if (def.kind !== "composite") continue;
        for (const node of def.body.nodes)
          expect(wf.processes[node.process], `${pname}/${node.id} -> ${node.process}`).toBeDefined();
      }
    });

    it("every binding names a sibling node's output or one of the container's inputs", () => {
      for (const [pname, def] of Object.entries(wf.processes)) {
        if (def.kind !== "composite") continue;
        const byId = new Map(def.body.nodes.map((n) => [n.id, n]));

        const check = (from: string, where: string): void => {
          const dot = from.indexOf(".");
          expect(dot, `${where}: "${from}" has no port half`).toBeGreaterThan(0);
          const head = from.slice(0, dot);
          const port = from.slice(dot + 1);

          if (head === "inputs") {
            expect(def.inputs[port], `${where}: ${pname} has no input ${port}`).toBeDefined();
            return;
          }
          const src = byId.get(head);
          expect(src, `${where}: no sibling node "${head}"`).toBeDefined();
          const srcDef = wf.processes[src!.process];
          expect(srcDef, `${where}: ${src!.process} is undeclared`).toBeDefined();
          expect(
            srcDef!.outputs[port],
            `${where}: ${src!.process} has no output ${port}`,
          ).toBeDefined();
        };

        for (const node of def.body.nodes)
          for (const [port, b] of Object.entries({ ...node.state, ...node.data }))
            check(b.from, `${pname}/${node.id}.${port}`);
        for (const [port, b] of Object.entries(def.body.returns))
          check(b.from, `${pname}.returns.${port}`);
      }
    });
  });
