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

import { deviceOf, spotNameOf } from "../model/common";
import type { Activity } from "../model/document";
import { accessesDevices, holdingDevices, type Scene } from "../model/scene";

export type GanttView = "device" | "flow" | "activity";

export const GANTT_VIEWS: readonly { id: GanttView; label: string; hint: string }[] = [
  { id: "device", label: "Device", hint: "one lane per machine — shows contention" },
  { id: "flow", label: "Flow", hint: "one lane per top-level step — shows concurrency" },
  { id: "activity", label: "Activity", hint: "one lane per activity — shows the sequence" },
];

/** `resting` is a step that holds its spots but not its device (§4.4.2). */
export type BarStyle = "processing" | "resting" | "transport" | "held" | "relay" | "replenishment";

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
  // Bars are filed by lane id first and numbered at the end, because spot
  // lanes are only known once the activities have been read.
  const filed: (Omit<Bar, "lane"> & { laneId: string })[] = [];
  /** device id → the spot lanes that sit under it, in order of first use. */
  const spotLanes = new Map<string, string[]>();

  scene.activities.forEach((a, index) => {
    const at = (id: string | undefined, style: BarStyle, label: string): void => {
      if (id) filed.push({ laneId: id, index, start: a.start, end: a.end, style, label });
    };

    switch (a.kind) {
      case "processing": {
        const style = styleOf(a, scene);
        if (style === "resting") {
          // A resting step holds spots, not a device (§4.4.2), and two of them
          // may share one device at the same time — a fridge with two slots.
          // On the device's own lane they would overlap, so each goes on the
          // lane of the spot it holds, directly under its device.
          for (const spot of heldSpots(a, scene)) {
            const device = deviceOf(spot);
            const list = spotLanes.get(device) ?? [];
            if (!list.includes(spot)) list.push(spot);
            spotLanes.set(device, list);
            at(spot, style, barLabel(a));
          }
          break;
        }
        const held = holdingDevices(a, scene.env);
        if (held.length) for (const d of held) at(d, style, barLabel(a));
        else at(NO_MACHINE, style, barLabel(a));
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
        } else if (a.fromSpot === a.toSpot) {
          // A same-spot move is a no-op no transporter performs (§6.4).
          at(from, "transport", "");
        } else {
          // A route that needs no transporter is performed by the devices
          // themselves — both are occupied, nothing else is (§4.6).
          at(from, "transport", barLabel(a));
          if (to !== from) at(to, "transport", "");
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

  // Machines in the scene's order, each followed by its spot lanes. A machine
  // nothing touches is dropped — an environment often declares more than a
  // given plan uses, and empty lanes are just noise — but one whose spots are
  // used keeps its row, so the spot lanes stay under the name they belong to.
  const used = new Set(filed.map((b) => b.laneId));
  const lanes: Lane[] = [];
  const machineIds = [...scene.machines.map((m) => m.id)];
  for (const device of spotLanes.keys()) if (!machineIds.includes(device)) machineIds.push(device);
  for (const id of machineIds) {
    const spots = spotLanes.get(id) ?? [];
    if (!used.has(id) && !spots.length) continue;
    const kind = scene.machines.find((m) => m.id === id)?.kind ?? "device";
    lanes.push({ id, label: id, tag: kind === "device" ? "" : kind });
    for (const spot of spots) lanes.push({ id: spot, label: `· ${spotNameOf(spot)}`, tag: "spot" });
  }
  if (used.has(NO_MACHINE)) lanes.push({ id: NO_MACHINE, label: NO_MACHINE, tag: "" });

  const laneOf = new Map(lanes.map((l, i) => [l.id, i]));
  const bars: Bar[] = [];
  for (const { laneId, ...bar } of filed) {
    const lane = laneOf.get(laneId);
    if (lane !== undefined) bars.push({ ...bar, lane });
  }
  return { lanes, bars };
}

/** The spots a processing step binds: its echo, or else its mode's (§6.3). */
function heldSpots(a: Activity & { kind: "processing" }, scene: Scene): string[] {
  const echo = [...Object.values(a.inputSpots ?? {}), ...Object.values(a.outputSpots ?? {})];
  if (echo.length) return [...new Set(echo)];
  const mode = scene.env?.processes[a.process]?.modes.find((m) => m.id === a.mode);
  return [...new Set([...Object.values(mode?.inputSpots ?? {}), ...Object.values(mode?.outputSpots ?? {})])];
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
      style: styleOf(a, scene),
      label: barLabel(a),
    })),
  };
}

function activityLayout(scene: Scene): GanttLayout {
  const order = scene.activities
    .map((a, index) => ({ a, index }))
    .sort((x, y) => x.a.start - y.a.start || x.index - y.index);

  return {
    lanes: order.map(({ a }) => ({ id: activityLabel(a), label: activityLabel(a), tag: KIND_TAG[a.kind] })),
    bars: order.map(({ a, index }, lane) => ({
      lane,
      index,
      start: a.start,
      end: a.end,
      style: styleOf(a, scene),
      label: "",
    })),
  };
}

/** Short enough for the gutter, still a word. */
const KIND_TAG: Readonly<Record<Activity["kind"], string>> = {
  processing: "step",
  transport: "move",
  relay: "wait",
  replenishment: "refill",
};

function styleOf(a: Activity, scene: Scene): BarStyle {
  switch (a.kind) {
    case "processing":
      return accessesDevices(a, scene.env) ? "processing" : "resting";
    case "transport":
      return "transport";
    case "relay":
      return "relay";
    case "replenishment":
      return "replenishment";
  }
}
