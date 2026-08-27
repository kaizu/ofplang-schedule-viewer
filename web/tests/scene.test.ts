/**
 * The scene indices, against real plans.
 *
 * These are the lookups every view is built on, so it matters that they are
 * total and that they group the way the specification says things group — a
 * multi-leg move under one arc, a transport holding three machines at once.
 */

import { describe, expect, it } from "vitest";

import { arcKey } from "../src/model/common";
import { activitiesUnder, buildScene, sameArc } from "../src/model/scene";
import { readEnvironmentText, readExecutionDocumentText, readWorkflowText } from "../src/read";
import { documentFiles, read, triples } from "./golden/corpus";

const sceneOf = (name: string) => {
  const t = triples.find((x) => x.name === name);
  if (!t) throw new Error(`no triple named ${name}`);
  return buildScene(
    readExecutionDocumentText(read(...t.plan)),
    readEnvironmentText(read(...t.environment)),
    readWorkflowText(read(...t.workflow)),
  );
};

describe("plate_batch — three levels of nesting", () => {
  const scene = sceneOf("plate_batch");

  it("indexes every processing activity under its own node path", () => {
    const processing = scene.activities.filter((a) => a.kind === "processing");
    const indexed = [...scene.byNode.values()].flat();
    expect(indexed).toHaveLength(processing.length);
    // Node paths are unique per activity here — no node runs twice.
    for (const list of scene.byNode.values()) expect(list).toHaveLength(1);
  });

  it("a collapsed composite stands for everything beneath it (D11)", () => {
    const b1 = activitiesUnder(scene, ["b1"]);
    const b2 = activitiesUnder(scene, ["b2"]);
    expect(b1.length).toBeGreaterThan(0);
    expect(b2.length).toBeGreaterThan(0);
    // The two branches are disjoint, and neither is the whole plan.
    expect(b1.filter((i) => b2.includes(i))).toEqual([]);
    expect(b1.length + b2.length).toBeLessThan(scene.activities.length);
    // Going one level deeper is a subset of the level above.
    const rep1 = activitiesUnder(scene, ["b2", "rep1"]);
    expect(rep1.every((i) => b2.includes(i))).toBe(true);
    expect(rep1.length).toBeLessThan(b2.length);
  });

  it("the whole plan sits under the empty path — the workflow interface", () => {
    expect(activitiesUnder(scene, [])).toHaveLength(scene.activities.length);
  });

  it("a transport holds its transporter and the devices at both ends (§4.5)", () => {
    for (const [i, a] of scene.activities.entries()) {
      if (a.kind !== "transport" || !a.transporter) continue;
      const holders = [...scene.byMachine.entries()]
        .filter(([, list]) => list.includes(i))
        .map(([id]) => id);
      expect(holders).toContain(a.transporter);
      expect(holders.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("occupancy is a fraction, and the busiest machine is actually busy", () => {
    for (const m of scene.machines) {
      expect(m.occupancy).toBeGreaterThanOrEqual(0);
      expect(m.occupancy).toBeLessThanOrEqual(1);
    }
    expect(scene.metrics.busiest[0]!.occupancy).toBeGreaterThan(0);
  });

  it("reports the makespan the plan reports, not a recomputed one", () => {
    expect(scene.metrics.makespan).toBe(scene.doc.objective?.value);
  });
});

describe("multi-leg moves", () => {
  it("group every leg and junction under one arc, in travel order (§6.4)", () => {
    // reroute_chain is the example that actually relays twice.
    const entry = documentFiles.find(([, f]) => f === "reroute_chain.replan.yaml");
    expect(entry, "reroute_chain.replan.yaml is missing from the corpus").toBeDefined();
    const scene = buildScene(readExecutionDocumentText(read(...entry!)));

    const multi = [...scene.byArc.entries()].filter(([, list]) => list.length > 1);
    expect(multi.length).toBeGreaterThan(0);

    for (const [key, list] of multi) {
      // Every member really does carry that arc.
      for (const i of list) {
        const a = scene.activities[i]!;
        expect(a.kind === "transport" || a.kind === "relay").toBe(true);
        if (a.kind === "transport" || a.kind === "relay") expect(arcKey(a.arc)).toBe(key);
      }
      // And they are ordered along the journey, not by document position.
      const starts = list.map((i) => scene.activities[i]!.start);
      expect([...starts].sort((x, y) => x - y)).toEqual(starts);
    }
  });

  it("selecting one leg selects the whole journey", () => {
    const entry = documentFiles.find(([, f]) => f === "reroute_chain.replan.yaml")!;
    const scene = buildScene(readExecutionDocumentText(read(...entry)));
    const leg = scene.activities.findIndex((a) => a.kind === "transport");
    expect(sameArc(scene, leg).length).toBeGreaterThan(1);

    // A processing activity is its own journey.
    const step = scene.activities.findIndex((a) => a.kind === "processing");
    expect(sameArc(scene, step)).toEqual([step]);
  });
});

describe("every plan in the corpus", () => {
  for (const [dir, name] of documentFiles)
    it(`builds a scene from ${name}`, () => {
      const scene = buildScene(readExecutionDocumentText(read(dir, name)));
      expect(scene.metrics.horizon).toBeGreaterThan(0);
      expect(scene.unit).not.toBe("");
      // Nothing is indexed twice, and nothing points past the end.
      for (const list of [...scene.byNode.values(), ...scene.byArc.values()]) {
        expect(new Set(list).size).toBe(list.length);
        for (const i of list) expect(scene.activities[i]).toBeDefined();
      }
    });
});
