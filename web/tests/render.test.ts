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

  it("marks a held device with a band, not a bar", () => {
    const held = [...g.plot.matchAll(/class="bar held[^"]*"[^>]*height="([\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    const work = [...g.plot.matchAll(/class="bar processing[^"]*"[^>]*height="([\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(held.length).toBeGreaterThan(0);
    expect(Math.max(...held)).toBeLessThan(Math.min(...work));
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

describe("holding without accessing (§4.4.2) — storage", () => {
  const t = triples.find((x) => x.name === "storage")!;
  const plan = readExecutionDocumentText(read(...t.plan));
  const env = readEnvironmentText(read(...t.environment));
  const scene = buildScene(plan, env);
  const chills = scene.activities
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.kind === "processing" && a.deviceAccess === false);

  it("reads the echo the plan writes where the mode does not access its device", () => {
    expect(chills.length).toBeGreaterThan(0);
  });

  it("draws a resting step hollow in every view", () => {
    for (const view of GANTT_VIEWS) {
      const { bars } = ganttLayout(scene, view.id);
      for (const { i } of chills) {
        const mine = bars.filter((b) => b.index === i);
        expect(mine.length, view.id).toBeGreaterThan(0);
        for (const b of mine) expect(b.style, view.id).toBe("resting");
      }
    }
  });

  it("puts a resting step on the spot it holds, directly under its device", () => {
    // Two chills share the fridge at once — legal, since neither accesses it —
    // so on the fridge's own lane they would overlap. Each spot is exclusive.
    const { lanes, bars } = ganttLayout(scene, "device");
    const fridge = lanes.findIndex((l) => l.id === "fridge");
    expect(fridge).toBeGreaterThanOrEqual(0);
    for (const { a, i } of chills) {
      const [bar, ...rest] = bars.filter((b) => b.index === i);
      expect(rest).toEqual([]);
      const lane = lanes[bar!.lane]!;
      expect(lane.tag).toBe("spot");
      expect(Object.values((a as { inputSpots?: Record<string, string> }).inputSpots ?? {})).toContain(lane.id);
      expect(bar!.lane).toBeGreaterThan(fridge);
      expect(lanes.slice(fridge + 1, bar!.lane + 1).every((l) => l.tag === "spot")).toBe(true);
    }
    // And no two bars on one lane overlap in time: every lane is one exclusive thing.
    for (let lane = 0; lane < lanes.length; lane++) {
      const on = bars
        .filter((b) => b.lane === lane && b.style !== "held" && b.style !== "relay" && b.end > b.start)
        .sort((x, y) => x.start - y.start);
      for (let k = 1; k < on.length; k++)
        expect(on[k]!.start, lanes[lane]!.id).toBeGreaterThanOrEqual(on[k - 1]!.end);
    }
  });

  it("does not count resting time as the device being held", () => {
    // Only moves in and out hold the fridge; the chills sit on it for far longer.
    const fridge = scene.machines.find((m) => m.id === "fridge")!;
    const moves = (scene.byMachine.get("fridge") ?? []).filter((i) => scene.activities[i]!.kind === "transport");
    const held = moves.reduce((n, i) => n + scene.activities[i]!.end - scene.activities[i]!.start, 0);
    expect(fridge.occupancy * scene.metrics.horizon).toBeLessThanOrEqual(held);
    // …but a resting step is still found on the device it rests on.
    for (const { i } of chills) expect(scene.byMachine.get("fridge")).toContain(i);
  });

  it("falls back to the environment's mode when the echo is left out", () => {
    const stripped = readExecutionDocumentText(read(...t.plan).replace(/^\s*device_access: false\s*$/gm, ""));
    expect(stripped.activities.some((a) => a.kind === "processing" && a.deviceAccess === false)).toBe(false);
    const recovered = buildScene(stripped, env);
    const { bars } = ganttLayout(recovered, "device");
    for (const { i } of chills) expect(bars.find((b) => b.index === i)!.style).toBe("resting");
  });
});

describe("a route that needs no transporter (§4.6)", () => {
  const doc = (transporter: string) => `
time: { unit: second }
activities:
  - kind: transport
    start: 0
    end: 3
    from_spot: hotel.a
    to_spot: hotel.b
    ${transporter}
    arc: { from: { node: [], port: plate }, to: { node: [Read], port: plate } }
`;

  it("reads `transporter: null` as a move nothing carries", () => {
    const a = readExecutionDocumentText(doc("transporter: null")).activities[0]!;
    expect(a.kind === "transport" && a.transporter).toBeFalsy();
  });

  it("refuses a real move that leaves the key out — null is the statement, an omission is not", () => {
    expect(() => readExecutionDocumentText(doc(""))).toThrow(/null for none/);
  });

  it("draws the move on the devices that perform it, and on no transporter lane", () => {
    const scene = buildScene(readExecutionDocumentText(doc("transporter: null")));
    const { lanes, bars } = ganttLayout(scene, "device");
    expect(bars.map((b) => [lanes[b.lane]!.id, b.style])).toEqual([["hotel", "transport"]]);
    expect(scene.machines.find((m) => m.id === "hotel")!.occupancy).toBe(1);
  });
});
