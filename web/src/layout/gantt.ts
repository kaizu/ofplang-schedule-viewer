/**
 * Gantt lanes and bars.
 *
 * Three ways to slice the same plan, ported from `ofp-schedule`'s
 * `visualize.py` (design.md D12 — the algorithm, not the code):
 *
 * - `device`   one lane per machine. A move draws a solid bar on its
 *              transporter and held bars on the devices at either end,
 *              because a transport occupies all three (§4.5). Best for
 *              reading contention.
 * - `flow`     one lane per top-level node of the entry composite, so
 *              parallel branches sit side by side. Best for reading
 *              concurrency at a glance.
 * - `activity` one lane per activity, in start order. Best for reading a
 *              plan step by step.
 *
 * Pure functions over the scene: no DOM, no colours, no pixels.
 */

import { deviceOf } from "../model/common";
import type { Activity } from "../model/document";
import { holdingDevices, type Scene } from "../model/scene";

export type GanttView = "device" | "flow" | "activity";

export const GANTT_VIEWS: readonly { id: GanttView; label: string; hint: string }[] = [
  { id: "device", label: "Device", hint: "one lane per machine — shows contention" },
  { id: "flow", label: "Flow", hint: "one lane per top-level step — shows concurrency" },
  { id: "activity", label: "Activity", hint: "one lane per activity — shows the sequence" },
];

export type BarStyle = "processing" | "transport" | "held" | "relay" | "replenishment";

export interface Lane {
  readonly id: string;
  readonly label: string;
  /** A short right-aligned tag in the gutter; empty when it says nothing. */
  readonly tag: string;
}

export interface Bar {
  readonly lane: number;
  /** Index into `scene.activities` — the identity used by the selection. */
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly style: BarStyle;
  readonly label: string;
}

export interface GanttLayout {
  readonly lanes: readonly Lane[];
  readonly bars: readonly Bar[];
}

export function ganttLayout(scene: Scene, view: GanttView): GanttLayout {
  switch (view) {
    case "device":
      return deviceLayout(scene);
    case "flow":
      return flowLayout(scene);
    case "activity":
      return activityLayout(scene);
  }
}

/** What to call an activity in one short phrase. */
export function activityLabel(a: Activity): string {
  switch (a.kind) {
    case "processing":
      return a.node.length ? a.node.join("/") : a.process;
    case "transport":
      return `${a.fromSpot} → ${a.toSpot}`;
    case "relay":
      return `wait at ${a.spot}`;
    case "replenishment":
      return `refill ${a.device}`;
  }
}

/** The short form used inside a bar, where there is little room. */
function barLabel(a: Activity): string {
  switch (a.kind) {
    case "processing":
      return a.node.length ? a.node[a.node.length - 1]! : a.process;
    case "transport":
      return `${deviceOf(a.fromSpot)} → ${deviceOf(a.toSpot)}`;
    case "relay":
      return "";
    case "replenishment":
      return `+${Object.keys(a.amounts).join(", ")}`;
  }
}

/** Lane for work that holds no machine at all — a Pure-Data-only step (§5.5).
 *  It exists only when something needs it; nothing disappears silently. */
const NO_MACHINE = "(no device)";

function deviceLayout(scene: Scene): GanttLayout {
  const lanes: Lane[] = scene.machines.map((m) => ({
    id: m.id,
    label: m.id,
    tag: m.kind === "device" ? "" : m.kind,
  }));
  lanes.push({ id: NO_MACHINE, label: NO_MACHINE, tag: "" });
  const laneOf = new Map(lanes.map((l, i) => [l.id, i]));
  const bars: Bar[] = [];

  scene.activities.forEach((a, index) => {
    const at = (id: string | undefined, style: BarStyle, label: string): void => {
      if (!id) return;
      const lane = laneOf.get(id);
      if (lane === undefined) return;
      bars.push({ lane, index, start: a.start, end: a.end, style, label });
    };

    switch (a.kind) {
      case "processing": {
        const held = holdingDevices(a, scene.env);
        if (held.length) for (const d of held) at(d, "processing", barLabel(a));
        else at(NO_MACHINE, "processing", barLabel(a));
        break;
      }
      case "transport": {
        const from = deviceOf(a.fromSpot);
        const to = deviceOf(a.toSpot);
        if (a.transporter) {
          at(a.transporter, "transport", barLabel(a));
          // Held, not moving: the endpoints are blocked for the duration (§4.5).
          at(from, "held", "");
          if (to !== from) at(to, "held", "");
        } else {
          // A same-spot move is a no-op no transporter performs (§6.4).
          at(from, "transport", "");
        }
        break;
      }
      case "relay":
        at(deviceOf(a.spot), "relay", "");
        break;
      case "replenishment":
        at(a.device, "replenishment", barLabel(a));
        at(a.replenisher, "replenishment", "");
        break;
    }
  });

  // Drop machines nothing touches — an environment often declares more than a
  // given plan uses, and empty lanes are just noise.
  const used = new Set(bars.map((b) => b.lane));
  if (used.size === lanes.length) return { lanes, bars };

  const keep = lanes.map((_, i) => i).filter((i) => used.has(i));
  const remap = new Map(keep.map((old, next) => [old, next]));
  return {
    lanes: keep.map((i) => lanes[i]!),
    bars: bars.map((b) => ({ ...b, lane: remap.get(b.lane)! })),
  };
}

/** The top-level node an activity belongs to; moves are filed under their source. */
function groupOf(a: Activity): string {
  if (a.kind === "processing") return a.node[0] ?? "—";
  if (a.kind === "replenishment") return "refills";
  const from = a.arc.from.node[0];
  const to = a.arc.to.node[0];
  return from ?? to ?? "interface";
}

function flowLayout(scene: Scene): GanttLayout {
  const order: string[] = [];
  for (const a of scene.activities) {
    const g = groupOf(a);
    if (!order.includes(g)) order.push(g);
  }
  const laneOf = new Map(order.map((g, i) => [g, i]));
  return {
    lanes: order.map((g) => ({ id: g, label: g, tag: "" })),
    bars: scene.activities.map((a, index) => ({
      lane: laneOf.get(groupOf(a))!,
      index,
      start: a.start,
      end: a.end,
      style: styleOf(a),
      label: barLabel(a),
    })),
  };
}

function activityLayout(scene: Scene): GanttLayout {
  const order = scene.activities
    .map((a, index) => ({ a, index }))
    .sort((x, y) => x.a.start - y.a.start || x.index - y.index);

  return {
    lanes: order.map(({ a }) => ({ id: activityLabel(a), label: activityLabel(a), tag: a.kind.slice(0, 5) })),
    bars: order.map(({ a, index }, lane) => ({
      lane,
      index,
      start: a.start,
      end: a.end,
      style: styleOf(a),
      label: "",
    })),
  };
}

function styleOf(a: Activity): BarStyle {
  switch (a.kind) {
    case "processing":
      return "processing";
    case "transport":
      return "transport";
    case "relay":
      return "relay";
    case "replenishment":
      return "replenishment";
  }
}
