/**
 * The scene — one plan, indexed for drawing.
 *
 * Everything the views need is derived once, here. The indices are keyed the
 * way the specification already identifies things: an activity by its node
 * path (§6.3) and a move by its logical arc (§6.4). That is what makes linked
 * highlighting a lookup rather than a search, and it is why the join is worth
 * testing (`tests/golden/join.test.ts`).
 *
 * Activities are referred to by their position in `activities`, which is
 * document order. That index is the identity used by every view and by the
 * selection.
 */

import { arcKey, deviceOf, pathKey, type NodePath } from "./common";
import type { Activity, ExecutionDocument, ProcessingActivity } from "./document";
import type { Environment } from "./environment";
import type { Workflow } from "./workflow";

export type MachineKind = "device" | "transporter" | "replenisher";

export interface Machine {
  readonly id: string;
  readonly kind: MachineKind;
  /** Fraction of the horizon this machine is held, 0..1. */
  readonly occupancy: number;
}

export interface Metrics {
  readonly makespan: number;
  readonly horizon: number;
  readonly counts: Readonly<Record<Activity["kind"], number>>;
  readonly busiest: readonly Machine[];
}

export interface Scene {
  readonly doc: ExecutionDocument;
  readonly env: Environment | undefined;
  readonly workflow: Workflow | undefined;

  readonly unit: string;
  readonly activities: readonly Activity[];

  /** node path → indices of the processing activities at that exact node. */
  readonly byNode: ReadonlyMap<string, readonly number[]>;
  /** logical arc → indices of its legs and junctions, in travel order. */
  readonly byArc: ReadonlyMap<string, readonly number[]>;
  /** machine id → indices of everything that holds it. */
  readonly byMachine: ReadonlyMap<string, readonly number[]>;

  readonly machines: readonly Machine[];
  readonly metrics: Metrics;
}

export function buildScene(
  doc: ExecutionDocument,
  env?: Environment,
  workflow?: Workflow,
): Scene {
  const activities = doc.activities;
  const horizon = activities.reduce((m, a) => Math.max(m, a.end), 0);
  const makespan = scalarObjective(doc) ?? horizon;

  const byNode = new Map<string, number[]>();
  const byArc = new Map<string, number[]>();
  const byMachine = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, k: string, i: number): void => {
    const list = m.get(k);
    if (list) list.push(i);
    else m.set(k, [i]);
  };

  const spans = new Map<string, [number, number][]>();
  const hold = (id: string | undefined, i: number, a: Activity): void => {
    if (!id) return;
    push(byMachine, id, i);
    const list = spans.get(id);
    if (list) list.push([a.start, a.end]);
    else spans.set(id, [[a.start, a.end]]);
  };

  activities.forEach((a, i) => {
    switch (a.kind) {
      case "processing":
        push(byNode, pathKey(a.node), i);
        for (const d of holdingDevices(a, env)) hold(d, i, a);
        break;
      case "transport":
        push(byArc, arcKey(a.arc), i);
        // A transport holds its transporter and both end devices (§4.5).
        hold(a.transporter, i, a);
        hold(deviceOf(a.fromSpot), i, a);
        if (deviceOf(a.toSpot) !== deviceOf(a.fromSpot)) hold(deviceOf(a.toSpot), i, a);
        break;
      case "relay":
        push(byArc, arcKey(a.arc), i);
        break;
      case "replenishment":
        hold(a.device, i, a);
        hold(a.replenisher, i, a);
        break;
    }
  });

  // Legs in travel order, so an Object trace reads front to back.
  for (const list of byArc.values())
    list.sort((x, y) => {
      const ax = activities[x]!;
      const ay = activities[y]!;
      const sx = "seq" in ax ? (ax.seq ?? 0) : 0;
      const sy = "seq" in ay ? (ay.seq ?? 0) : 0;
      return sx - sy || ax.start - ay.start || x - y;
    });

  const machines = collectMachines(env, spans, horizon);

  const counts: Record<Activity["kind"], number> = {
    processing: 0,
    transport: 0,
    relay: 0,
    replenishment: 0,
  };
  for (const a of activities) counts[a.kind] += 1;

  return {
    doc,
    env,
    workflow,
    unit: doc.time?.unit ?? env?.time?.unit ?? "",
    activities,
    byNode,
    byArc,
    byMachine,
    machines,
    metrics: {
      makespan,
      horizon,
      counts,
      busiest: machines.filter((m) => m.occupancy > 0).slice(0, 10),
    },
  };
}

/**
 * Machines in a stable order: the environment's, when there is one, so two
 * plans of the same lab line up lane for lane. Otherwise whatever the document
 * mentions, which is all a bare plan gives us.
 */
function collectMachines(
  env: Environment | undefined,
  spans: ReadonlyMap<string, [number, number][]>,
  horizon: number,
): Machine[] {
  const out: Machine[] = [];
  const seen = new Set<string>();
  const add = (id: string, kind: MachineKind): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const held = spans.get(id);
    out.push({
      id,
      kind,
      occupancy: held && horizon > 0 ? mergedLength(held) / horizon : 0,
    });
  };

  for (const d of env?.devices ?? []) add(d.id, "device");
  for (const t of env?.transporters ?? []) add(t.id, "transporter");
  for (const r of env?.replenishers ?? []) add(r.id, "replenisher");
  for (const id of spans.keys()) add(id, "device");

  return out;
}

/** Total time covered by a set of possibly overlapping intervals. */
function mergedLength(intervals: readonly [number, number][]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur = sorted[0];
  if (!cur) return 0;
  let [cs, ce] = cur;
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]!;
    if (s > ce) {
      total += ce - cs;
      cs = s;
      ce = e;
    } else if (e > ce) ce = e;
  }
  return total + (ce - cs);
}

/** §6.1: `objective.value` is a scalar or a list; the makespan is the first. */
function scalarObjective(doc: ExecutionDocument): number | undefined {
  const v = doc.objective?.value;
  if (typeof v === "number") return v;
  if (Array.isArray(v) && typeof v[0] === "number") return v[0];
  return undefined;
}

/**
 * The devices a processing activity holds.
 *
 * §6.3 makes `devices` a *derivable echo* that a document may leave out — a
 * status carried into a replan often does. Reading it as the truth makes such
 * an activity vanish from any device-keyed view, so recover it: from the
 * environment's mode when there is one (authoritative, and it may hold a
 * device that owns no spot), otherwise from the qualified spots the activity
 * does carry. A Pure-Data-only step legitimately holds nothing and returns [].
 */
export function holdingDevices(a: ProcessingActivity, env?: Environment): string[] {
  if (a.devices?.length) return [...a.devices];

  const mode = env?.processes[a.process]?.modes.find((m) => m.id === a.mode);
  if (mode?.devices.length) return [...mode.devices];

  const spots = [...Object.values(a.inputSpots ?? {}), ...Object.values(a.outputSpots ?? {})];
  return [...new Set(spots.map(deviceOf))];
}

/** Every activity at or below a node — a collapsed composite stands for all of
 *  its descendants, which is what D11's badge counts. */
export function activitiesUnder(scene: Scene, path: NodePath): number[] {
  const prefix = pathKey(path);
  const out: number[] = [];
  for (const [key, list] of scene.byNode) {
    if (prefix === "" || key === prefix || key.startsWith(prefix + ".")) out.push(...list);
  }

  // Moves belong to a node when either end of their arc sits under it.
  scene.activities.forEach((a, i) => {
    if (a.kind !== "transport" && a.kind !== "relay") return;
    for (const end of [a.arc.from, a.arc.to]) {
      const k = pathKey(end.node);
      if (k !== "" && (k === prefix || k.startsWith(prefix + ".") || prefix === "")) {
        out.push(i);
        return;
      }
    }
  });

  return [...new Set(out)].sort((x, y) => x - y);
}

/** The activities that move the same Object as this one — its whole journey. */
export function sameArc(scene: Scene, index: number): number[] {
  const a = scene.activities[index];
  if (!a || (a.kind !== "transport" && a.kind !== "relay")) return [index];
  return [...(scene.byArc.get(arcKey(a.arc)) ?? [index])];
}
