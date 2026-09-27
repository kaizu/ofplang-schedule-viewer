/**
 * No arc runs through a box it does not join (design.md D54).
 *
 * An arc that skips a column of the layered layout used to be drawn straight
 * across it, through whatever sat there — data_flow's plate went through the
 * composite that scores its reading, reformatter's plates through a Biomek.
 * The drawn path is sampled, and every box it enters must be one of its own
 * ends or a container it is inside of.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildGraph, compositeKeys, type GraphNode } from "../src/model/graph";
import { edgeSegments, layoutGraph, type GraphLayout, type LaidEdge } from "../src/layout/graph";
import { readWorkflowText } from "../src/read";
import { read, workflowFiles } from "./golden/corpus";

const CURATED = fileURLToPath(new URL("../../datasets/curated/", import.meta.url));

/** Points along the drawn path, every ~2px. */
export function sample(e: LaidEdge): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const [p0, c1, c2, p3] of edgeSegments(e)) {
    for (let t = 0; t <= 1; t += 0.02) {
      const u = 1 - t;
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
      });
    }
  }
  return out;
}

const inside = (key: string, container: string): boolean =>
  container === "" || key === container || key.startsWith(`${container}.`);

/** Every box an arc passes through that it has no business in. */
export function trespasses(layout: GraphLayout): string[] {
  const out: string[] = [];
  for (const e of layout.edges) {
    const pts = sample(e);
    const name = `${e.fromKey || "main"}.${e.fromPort} -> ${e.toKey || "main"}.${e.toPort}`;
    for (const n of layout.leaves) {
      if (n.key === e.fromKey || n.key === e.toKey) continue;
      if (pts.some((p) => p.x > n.x + 1 && p.x < n.x + n.w - 1 && p.y > n.y + 1 && p.y < n.y + n.h - 1))
        out.push(`${name} through ${n.key}`);
    }
    // An open container the arc is not inside of, and does not end on.
    for (const s of layout.shells) {
      if (inside(e.fromKey, s.key) || inside(e.toKey, s.key)) continue;
      if (pts.some((p) => p.x > s.x && p.x < s.x + s.w && p.y > s.y && p.y < s.y + s.h))
        out.push(`${name} through open ${s.key}`);
    }
  }
  return out;
}

const cases: { name: string; graph: GraphNode }[] = [
  ...workflowFiles.map(([dir, f]) => ({ name: f, graph: buildGraph(readWorkflowText(read(dir, f))) })),
  ...readdirSync(CURATED)
    .filter((f) => f.endsWith(".workflow.yaml"))
    .map((f) => ({ name: `curated/${f}`, graph: buildGraph(readWorkflowText(readFileSync(join(CURATED, f), "utf8"))) })),
];

describe("no arc runs through a box it does not join", () => {
  for (const { name, graph } of cases) {
    it(`${name}, closed`, () => {
      expect(trespasses(layoutGraph(graph, new Set()))).toEqual([]);
    });
    it(`${name}, every composite open`, () => {
      expect(trespasses(layoutGraph(graph, new Set(compositeKeys(graph))))).toEqual([]);
    });
  }
});

describe("a skipped column", () => {
  // Three columns, a long arc across the middle one, and one more into the
  // container's output from the first column: both need a lane.
  const wf = readWorkflowText(`
spec_version: "0.0"
types:
  Plate: { domain: object }
processes:
  a: { kind: atomic, inputs: { p: { type: Plate, phase: data } }, outputs: { p: { type: Plate, phase: data }, q: { type: Float, phase: data } } }
  b: { kind: atomic, inputs: { q: { type: Float, phase: data } }, outputs: { r: { type: Float, phase: data } } }
  c: { kind: atomic, inputs: { p: { type: Plate, phase: data }, r: { type: Float, phase: data } } }
  main:
    kind: composite
    inputs: { p: { type: Plate, phase: data } }
    outputs: { q: { type: Float, phase: data } }
    body:
      nodes:
        - { id: A, process: a, state: { p: { from: inputs.p } } }
        - { id: B, process: b, bind: { q: { from: A.q } } }
        - { id: C, process: c, state: { p: { from: A.p } }, bind: { r: { from: B.r } } }
      returns:
        q: { from: A.q }
entry: main
`);
  const layout = layoutGraph(buildGraph(wf), new Set());
  const edge = (from: string, to: string) =>
    layout.edges.find((e) => `${e.fromKey}.${e.fromPort}` === from && `${e.toKey}.${e.toPort}` === to)!;

  it("routes through the columns it skips, and only those", () => {
    expect(edge("A.p", "C.p").route).toHaveLength(1); // across B's column
    expect(edge("A.q", ".q").route).toHaveLength(2); // across B's and C's
    expect(edge("A.q", "B.q").route ?? []).toHaveLength(0); // adjacent: no lane
  });

  it("keeps clear of every box", () => {
    expect(trespasses(layout)).toEqual([]);
  });

  it("leaves a layout with no skipped column exactly as it was", () => {
    // Guarded here and by the other examples' screenshots: a lane only exists
    // where an arc skips a column, and without one nothing moves.
    const plain = readWorkflowText(read(...workflowFiles.find(([, f]) => f === "simple.workflow.yaml")!));
    const l = layoutGraph(buildGraph(plain), new Set());
    expect(l.edges.every((e) => (e.route ?? []).length === 0)).toBe(true);
  });
});

describe("a cycle (invalid v0, but anything can be dropped on the window)", () => {
  // A cycle leaves a gap in the layers, and a long arc gives it a lane: the
  // layout must still end, with every coordinate a number.
  const wf = readWorkflowText(`
spec_version: "0.0"
processes:
  s: { kind: atomic, inputs: { a: { type: Float, phase: data }, b: { type: Float, phase: data } }, outputs: { o: { type: Float, phase: data } } }
  main:
    kind: composite
    inputs: {}
    outputs: { r: { type: Float, phase: data } }
    body:
      nodes:
        - { id: A, process: s, bind: { a: { from: D.o } } }
        - { id: B, process: s, bind: { a: { from: A.o } } }
        - { id: C, process: s, bind: { a: { from: B.o } } }
        - { id: D, process: s, bind: { a: { from: C.o }, b: { from: A.o } } }
      returns: { r: { from: A.o } }
entry: main
`);

  it("is laid out, with finite coordinates", () => {
    const l = layoutGraph(buildGraph(wf), new Set());
    const numbers = [
      l.width,
      l.height,
      ...l.leaves.flatMap((n) => [n.x, n.y, n.w, n.h]),
      ...l.edges.flatMap((e) => [e.from.x, e.from.y, e.to.x, e.to.y, ...(e.route ?? []).flatMap((w) => [w.x0, w.x1, w.y])]),
    ];
    expect(numbers.every(Number.isFinite)).toBe(true);
  });
});
