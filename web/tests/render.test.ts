/**
 * Layout and SVG generation.
 *
 * Both layers are pure — lanes and bars are numbers, and the renderer returns
 * strings — so they can be checked without a browser. That matters here: this
 * is the only automated look at what actually reaches the screen.
 */

import { describe, expect, it } from "vitest";

import { deviceOf } from "../src/model/common";
import { buildScene } from "../src/model/scene";
import { GANTT_VIEWS, activityLabel, ganttLayout } from "../src/layout/gantt";
import { makeScale, niceStep, unitAbbrev } from "../src/layout/scale";
import { readEnvironmentText, readExecutionDocumentText } from "../src/read";
import { renderGantt } from "../src/view/gantt";
import { documentFiles, read, triples } from "./golden/corpus";

const plateBatch = (() => {
  const t = triples.find((x) => x.name === "plate_batch")!;
  return buildScene(readExecutionDocumentText(read(...t.plan)), readEnvironmentText(read(...t.environment)));
})();

describe("the time scale", () => {
  it("steps in units a lab reads, not round decimals", () => {
    expect(niceStep(50)).toBe(10); // ~5 gridlines over a 50 s plan
    expect(niceStep(900)).toBe(120); // 2 min, not 100 s
    expect(niceStep(7)).toBe(1);
  });

  it("maps 0 to the left pad and the max to the right", () => {
    const s = makeScale(50, 500, 10);
    expect(s.x(0)).toBe(10);
    expect(s.x(50)).toBe(490);
    expect(s.ticks[0]).toBe(0);
    expect(s.ticks.at(-1)).toBeLessThanOrEqual(50);
  });

  it("abbreviates the document's own unit, and passes through what it does not know", () => {
    expect(unitAbbrev("second")).toBe("s");
    expect(unitAbbrev("tick")).toBe("tick");
  });
});

describe("the device view", () => {
  const { lanes, bars } = ganttLayout(plateBatch, "device");

  it("draws no empty lanes", () => {
    const used = new Set(bars.map((b) => b.lane));
    expect(used.size).toBe(lanes.length);
  });

  it("gives a move a solid bar on its transporter and held bars at both ends (§4.5)", () => {
    const laneName = (i: number) => lanes[i]!.id;
    for (const [i, a] of plateBatch.activities.entries()) {
      if (a.kind !== "transport" || !a.transporter) continue;
      const mine = bars.filter((b) => b.index === i);
      const solid = mine.filter((b) => b.style === "transport");
      const held = mine.filter((b) => b.style === "held");
      expect(solid.map((b) => laneName(b.lane))).toEqual([a.transporter]);
      expect(new Set(held.map((b) => laneName(b.lane)))).toEqual(
        new Set([deviceOf(a.fromSpot), deviceOf(a.toSpot)].filter((d, j, all) => all.indexOf(d) === j)),
      );
    }
  });

  it("puts each processing activity on every device its mode holds", () => {
    for (const [i, a] of plateBatch.activities.entries()) {
      if (a.kind !== "processing") continue;
      const mine = bars.filter((b) => b.index === i);
      expect(mine).toHaveLength((a.devices ?? []).length);
      for (const b of mine) expect(b.style).toBe("processing");
    }
  });
});

describe("the other views", () => {
  it("activity view gives every activity its own lane, in start order", () => {
    const { lanes, bars } = ganttLayout(plateBatch, "activity");
    expect(lanes).toHaveLength(plateBatch.activities.length);
    expect(bars).toHaveLength(plateBatch.activities.length);
    const starts = bars.map((b) => b.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("flow view puts the two branches of plate_batch on their own lanes", () => {
    const { lanes, bars } = ganttLayout(plateBatch, "flow");
    expect(lanes.map((l) => l.id)).toEqual(expect.arrayContaining(["b1", "b2"]));
    expect(bars).toHaveLength(plateBatch.activities.length);
  });

  it("every view covers every activity and stays inside its lanes", () => {
    for (const view of GANTT_VIEWS) {
      for (const [dir, name] of documentFiles) {
        const scene = buildScene(readExecutionDocumentText(read(dir, name)));
        const { lanes, bars } = ganttLayout(scene, view.id);
        for (const b of bars) {
          expect(b.lane, `${name}/${view.id}`).toBeGreaterThanOrEqual(0);
          expect(b.lane, `${name}/${view.id}`).toBeLessThan(lanes.length);
          expect(scene.activities[b.index], `${name}/${view.id}`).toBeDefined();
        }
        const covered = new Set(bars.map((b) => b.index));
        expect(covered.size, `${name}/${view.id} misses activities`).toBe(scene.activities.length);
      }
    }
  });
});

describe("labels", () => {
  it("name an activity by what a person would call it", () => {
    const nested = plateBatch.activities.find((a) => a.kind === "processing" && a.node.length > 1)!;
    const top = plateBatch.activities.find((a) => a.kind === "processing" && a.node.length === 1)!;
    const move = plateBatch.activities.find((a) => a.kind === "transport")!;
    // A nested step is named by its whole path, so two `peal` steps in
    // different branches do not read as the same thing.
    expect(activityLabel(nested)).toMatch(/\//);
    expect(activityLabel(top)).not.toMatch(/\//);
    expect(activityLabel(move)).toMatch(/→/);
  });
});

describe("the rendered SVG", () => {
  const g = renderGantt(plateBatch, {
    view: "device",
    baseWidth: 800,
    zoom: 1,
    lit: new Set(),
    showLabels: true,
  });

  it("carries a hit target for every activity", () => {
    const hits = new Set([...g.plot.matchAll(/data-i="(\d+)"/g)].map((m) => Number(m[1])));
    expect(hits.size).toBe(plateBatch.activities.length);
  });

  it("declares the hatch pattern its held bars need", () => {
    // The reference itself lives in the stylesheet (`.bar.held { fill: url(#held) }`),
    // so what the markup owes is the definition and the class.
    expect(g.plot).toContain('<pattern id="held"');
    expect(g.plot).toMatch(/class="bar held[^"]*"/);
  });

  it("labels the axis with the document's unit", () => {
    expect(g.axis).toContain("TIME (S)");
  });

  it("dims everything but the selection", () => {
    const lit = renderGantt(plateBatch, {
      view: "device",
      baseWidth: 800,
      zoom: 1,
      lit: new Set([0]),
      showLabels: true,
    });
    expect(lit.plot).toMatch(/class="bar [^"]*lit/);
    expect(lit.plot).toMatch(/class="bar [^"]*dim/);
  });

  it("draws the now marker only when the document has one (§6.1)", () => {
    expect(g.plot).not.toContain("nowline");

    const replan = documentFiles.find(([, f]) => f === "simple.replan.yaml")!;
    const scene = buildScene(readExecutionDocumentText(read(...replan)));
    const r = renderGantt(scene, {
      view: "device",
      baseWidth: 800,
      zoom: 1,
      lit: new Set(),
      showLabels: true,
    });
    expect(scene.doc.now).toBeDefined();
    expect(r.plot).toContain("nowline");
    expect(r.axis).toContain("now");
  });

  it("draws a relay as a point, since it is instantaneous (§6.4.1)", () => {
    const chain = documentFiles.find(([, f]) => f === "reroute_chain.replan.yaml")!;
    const scene = buildScene(readExecutionDocumentText(read(...chain)));
    const r = renderGantt(scene, {
      view: "flow",
      baseWidth: 800,
      zoom: 1,
      lit: new Set(),
      showLabels: true,
    });
    expect(r.plot).toMatch(/class="bar relay[^"]*"[^>]*transform="rotate/);
  });

  it("escapes text that comes from the document", () => {
    const nasty = buildScene(
      readExecutionDocumentText(`
time: { unit: second }
activities:
  - kind: processing
    start: 0
    end: 1
    process: "p"
    mode: "0"
    node: ["<script>"]
    devices: ["d"]
`),
    );
    const r = renderGantt(nasty, {
      view: "device",
      baseWidth: 400,
      zoom: 1,
      lit: new Set(),
      showLabels: true,
    });
    expect(r.plot).not.toContain("<script>");
    expect(r.plot + r.gutter).toContain("&lt;script&gt;");
  });
});

describe("activities whose device echo is missing (§6.3)", () => {
  // `devices` is a derivable echo the document may leave out — a status
  // carried into a replan routinely does. Reading it as the truth once made
  // such an activity disappear from the device view entirely.
  const withoutEcho = buildScene(
    readExecutionDocumentText(`
time: { unit: second }
activities:
  - kind: processing
    status: completed
    start: 0
    end: 2
    process: source
    mode: "0"
    node: [SampleSource]
    output_spots: { source_out: station_0.core }
`),
  );

  it("still hold the device their spots name", () => {
    expect(withoutEcho.byMachine.get("station_0")).toEqual([0]);
    expect(withoutEcho.machines.find((m) => m.id === "station_0")!.occupancy).toBe(1);
  });

  it("still get a bar in the device view", () => {
    const { lanes, bars } = ganttLayout(withoutEcho, "device");
    expect(bars).toHaveLength(1);
    expect(lanes[bars[0]!.lane]!.id).toBe("station_0");
  });

  it("a step that truly holds nothing gets a lane of its own rather than vanishing", () => {
    const pureData = buildScene(
      readExecutionDocumentText(`
time: { unit: second }
activities:
  - kind: processing
    start: 0
    end: 0
    process: add
    mode: "0"
    node: [Add]
`),
    );
    const { lanes, bars } = ganttLayout(pureData, "device");
    expect(bars).toHaveLength(1);
    expect(lanes[bars[0]!.lane]!.id).toBe("(no device)");
  });
});
