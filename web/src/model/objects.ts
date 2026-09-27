/**
 * Objects — which physical thing is which, across a plan.
 *
 * The plan names no Object: it has arcs (§6.4), and each atomic process says
 * what becomes of the Objects at its ports (workflow spec §14). Chaining arcs
 * through those declarations is what tells one plate from another
 * (design.md D57).
 *
 * Where the chain cannot be followed — a declaration missing, a move the plan
 * does not have, two spots that do not meet — nothing is drawn and the reason
 * is given instead. A lifeline pieced together past a gap would look exactly
 * like a true one (design.md D59).
 */

import { isBoundary, pathKey, type ArcRef, type NodePath, type PortRef, type SpotRef } from "./common";
import type { ProcessingActivity } from "./document";
import { carriesObject } from "./graph";
import { accessesDevices, type Scene } from "./scene";
import type { AtomicProcess, ObjectsSection, ProcessDef, Workflow } from "./workflow";

export const OBJECT_IDENTITY_MAP = "object_identity_map";

/**
 * The Object behaviour an atomic process has — written, or inferred.
 *
 * workflow spec §15: only where `objects` is omitted altogether does the
 * `object_identity_map` marker imply one; it maps every Object-bearing input
 * to the Object-bearing output of the same name, type and phase. A written
 * section is taken as it stands, marker or not — no implicit completion. A
 * port the inference cannot pair is left without a fate, as the spec leaves
 * it, and `unaccountedPorts` reports it.
 */
export function objectsOf(def: AtomicProcess, wf: Pick<Workflow, "types">): ObjectsSection {
  if (def.objects) return def.objects;
  if (!def.behavior?.includes(OBJECT_IDENTITY_MAP)) return {};

  const map: Record<string, string> = {};
  for (const [port, decl] of Object.entries(def.inputs)) {
    if (!carriesObject(decl.type, wf)) continue;
    const out = def.outputs[port];
    if (out && out.type === decl.type && out.phase === decl.phase) map[`outputs.${port}`] = `inputs.${port}`;
  }
  return { map };
}

/**
 * Object-bearing ports of atomic processes that no declaration accounts for
 * (workflow spec §13), as `<process>.inputs.<port>` / `<process>.outputs.<port>`.
 * A workflow with any is not valid, and its Objects cannot be told apart.
 */
export function unaccountedPorts(wf: Workflow): string[] {
  const out: string[] = [];
  for (const [name, def] of Object.entries(wf.processes)) {
    if (def.kind !== "atomic") continue;
    const o = objectsOf(def, wf);
    const moved = transformPaths(o.transform);
    const ended = new Set([...(o.consume ?? []), ...Object.values(o.map ?? {}), ...moved]);
    const begun = new Set([...(o.create ?? []), ...Object.keys(o.map ?? {}), ...moved]);
    for (const [port, d] of Object.entries(def.inputs))
      if (carriesObject(d.type, wf) && !ended.has(`inputs.${port}`)) out.push(`${name}.inputs.${port}`);
    for (const [port, d] of Object.entries(def.outputs))
      if (carriesObject(d.type, wf) && !begun.has(`outputs.${port}`)) out.push(`${name}.outputs.${port}`);
  }
  return out;
}

/** Every path a `transform` list names (§14.4), read leniently. */
function transformPaths(t: unknown): string[] {
  if (!Array.isArray(t)) return [];
  const out: string[] = [];
  for (const entry of t)
    for (const side of ["inputs", "outputs"])
      for (const p of Object.values((entry as Record<string, Record<string, unknown>>)?.[side] ?? {}))
        if (typeof p === "string") out.push(p);
  return out;
}

/* ── lifelines ──────────────────────────────────────────────────────── */

/**
 * Where an Object is over one stretch of time (§4.4, §4.5).
 *
 * - `processing` inside a step that accesses its device, `resting` inside
 *   one that only holds its spots (§4.4.2)
 * - `waiting` on a spot between steps — before a move picks it up, after a
 *   move drops it off, at a relay between legs
 * - `transport` a move, `relay` the instant a leg hands over to the next
 *
 * `from` and `to` are where the stretch begins and ends; they differ only
 * for a move and for a step whose output spot is not its input spot. Either
 * may be absent where the document leaves a step's spots out (§6.3).
 */
export type SegmentKind = "processing" | "resting" | "waiting" | "transport" | "relay";

export interface Segment {
  readonly kind: SegmentKind;
  readonly start: number;
  readonly end: number;
  readonly from?: SpotRef;
  readonly to?: SpotRef;
  /** Index into `scene.activities`; absent on a wait, which is no activity. */
  readonly activity?: number;
}

export type Origin =
  | { readonly kind: "create"; readonly node: NodePath; readonly port: string }
  | { readonly kind: "input"; readonly port: string };

export type Fate =
  | { readonly kind: "consume"; readonly node: NodePath; readonly port: string }
  | { readonly kind: "output"; readonly port: string };

export interface ObjectTrace {
  /** Stable within a plan: where the Object came from. */
  readonly id: string;
  /** Type and origin, e.g. `Plate · PrepA.plate` (design.md D58). */
  readonly label: string;
  readonly type: string;
  readonly origin: Origin;
  readonly fate: Fate;
  /** In time order, contiguous: each begins where and when the last ended. */
  readonly segments: readonly Segment[];
  /** The arcs it travels, as `arcKey`s, in order. */
  readonly arcs: readonly string[];
  /** Every activity it takes part in, in order. */
  readonly activities: readonly number[];
}

export type ObjectTracing =
  | { readonly ok: true; readonly traces: readonly ObjectTrace[] }
  | { readonly ok: false; readonly reasons: readonly string[] };

const portKey = (e: PortRef): string => `${pathKey(e.node)}|${e.port}`;
const portName = (node: NodePath, port: string): string =>
  node.length ? `${node.join(".")}.${port}` : `inputs.${port}`;

class Untraceable extends Error {}

/**
 * Follow every Object of a plan from where it appears to where it ends.
 *
 * One workflow per plan (design.md D42): arcs are keyed without a job.
 */
export function traceObjects(scene: Scene): ObjectTracing {
  const wf = scene.workflow;
  if (!wf) return { ok: false, reasons: ["no workflow — Objects are told apart by its declarations"] };

  const missing = unaccountedPorts(wf);
  if (missing.length)
    return {
      ok: false,
      reasons: missing.map((p) => `${p} carries an Object but no \`objects\` declaration accounts for it`),
    };

  try {
    return { ok: true, traces: new Tracer(scene, wf).run() };
  } catch (e) {
    if (e instanceof Untraceable) return { ok: false, reasons: [e.message] };
    throw e;
  }
}

class Tracer {
  private readonly arcs = new Map<string, { arc: ArcRef; legs: readonly number[] }>();
  private readonly arcFrom = new Map<string, string>();
  private readonly arcTo = new Map<string, string>();
  private readonly visited = new Set<string>();
  private readonly horizon: number;

  constructor(
    private readonly scene: Scene,
    private readonly wf: Workflow,
  ) {
    this.horizon = scene.metrics.horizon;
    for (const [key, legs] of scene.byArc) {
      const first = scene.activities[legs[0]!];
      if (!first || !("arc" in first)) continue;
      const arc = first.arc;
      this.arcs.set(key, { arc, legs });
      // An Object is at one place at a time, so a port has at most one move
      // out and one move in. An entry input's key is its bare port (`|name`).
      for (const [index, end] of [
        [this.arcFrom, arc.from],
        [this.arcTo, arc.to],
      ] as const) {
        const k = portKey(end);
        if (index.has(k)) throw new Untraceable(`two moves leave or reach ${portName(end.node, end.port)}`);
        index.set(k, key);
      }
    }
  }

  run(): ObjectTrace[] {
    const traces: ObjectTrace[] = [];

    // Born inside the workflow: every created output of every step.
    for (const [key, list] of this.scene.byNode) {
      const def = this.atomicAt(key.split("."));
      for (const path of objectsOf(def, this.wf).create ?? []) {
        const port = path.slice("outputs.".length);
        const i = this.onlyStep(key, list);
        const node = (this.scene.activities[i] as ProcessingActivity).node;
        traces.push(this.follow({ kind: "create", node, port }, def.outputs[port]?.type ?? "", i));
      }
    }
    // Born outside it: every entry input, which arrives by a boundary arc.
    for (const { arc } of this.arcs.values())
      if (isBoundary(arc.from)) {
        const entry = this.wf.processes[this.wf.entry];
        traces.push(this.follow({ kind: "input", port: arc.from.port }, entry?.inputs[arc.from.port]?.type ?? ""));
      }

    // Every Object a step takes in must have been brought to it. An entry
    // input whose boundary move is missing would otherwise go unnoticed.
    for (const key of this.scene.byNode.keys()) {
      const def = this.atomicAt(key.split("."));
      for (const [port, d] of Object.entries(def.inputs))
        if (carriesObject(d.type, this.wf) && !this.arcTo.has(`${key}|${port}`))
          throw new Untraceable(`${key}.${port}: the plan brings no Object to it`);
    }
    // Checked second: a move no Object reaches is usually the symptom of the above.
    for (const key of this.arcs.keys())
      if (!this.visited.has(key)) throw new Untraceable(`the move ${key} belongs to no Object`);

    return traces.sort(
      (a, b) => (a.segments[0]?.start ?? 0) - (b.segments[0]?.start ?? 0) || a.id.localeCompare(b.id),
    );
  }

  private follow(origin: Origin, type: string, birth?: number): ObjectTrace {
    const segments: Segment[] = [];
    const arcs: string[] = [];
    const where = origin.kind === "create" ? portName(origin.node, origin.port) : `inputs.${origin.port}`;
    const id = origin.kind === "create" ? `create:${where}` : `input:${origin.port}`;

    const push = (s: Segment): void => {
      const last = segments[segments.length - 1];
      if (last) {
        if (s.start < last.end) throw new Untraceable(`${where}: its steps overlap in time at ${s.start}`);
        if (last.to && s.from && last.to !== s.from)
          throw new Untraceable(`${where}: it is left on ${last.to} but next taken from ${s.from}`);
        // Between two things that happen to it, it sits where the first left it.
        if (s.start > last.end)
          segments.push({ kind: "waiting", start: last.end, end: s.start, from: last.to ?? s.from, to: last.to ?? s.from });
      }
      segments.push(s);
    };

    // Where the Object stands now: an output port it leaves by.
    let at: PortRef;
    if (origin.kind === "create") {
      const a = this.scene.activities[birth!] as ProcessingActivity;
      const spot = a.outputSpots?.[origin.port];
      push(this.step(birth!, spot, spot));
      at = { node: origin.node, port: origin.port };
    } else {
      at = { node: [], port: origin.port };
    }

    for (;;) {
      const key = this.arcFrom.get(portKey(at));
      // A valid workflow discards no Object (workflow spec §13), so every
      // Object output goes somewhere; a plan without the move is missing it.
      if (!key) throw new Untraceable(`${portName(at.node, at.port)}: the plan moves it nowhere`);
      if (this.visited.has(key)) throw new Untraceable(`${where}: the move ${key} is reached twice`);
      this.visited.add(key);
      arcs.push(key);

      const { arc, legs } = this.arcs.get(key)!;
      if (isBoundary(arc.from) && segments.length === 0) {
        // An entry input is on its spot from the start of the run (§6.8).
        const first = this.scene.activities[legs[0]!]!;
        const spot = "fromSpot" in first ? first.fromSpot : undefined;
        if (first.start > 0) segments.push({ kind: "waiting", start: 0, end: first.start, from: spot, to: spot });
      }
      for (const i of legs) {
        const a = this.scene.activities[i]!;
        if (a.kind === "transport")
          push({ kind: "transport", start: a.start, end: a.end, from: a.fromSpot, to: a.toSpot, activity: i });
        else if (a.kind === "relay") push({ kind: "relay", start: a.start, end: a.end, from: a.spot, to: a.spot, activity: i });
      }

      if (isBoundary(arc.to)) {
        // A final output rests where it was delivered until the plan ends (§6.8).
        const last = segments[segments.length - 1]!;
        if (this.horizon > last.end)
          segments.push({ kind: "waiting", start: last.end, end: this.horizon, from: last.to, to: last.to });
        return this.done(id, where, type, origin, { kind: "output", port: arc.to.port }, segments, arcs);
      }

      const nodeKey = pathKey(arc.to.node);
      const i = this.onlyStep(nodeKey, this.scene.byNode.get(nodeKey));
      const a = this.scene.activities[i] as ProcessingActivity;
      const o = objectsOf(this.atomicAt(arc.to.node), this.wf);
      const inPath = `inputs.${arc.to.port}`;
      const inSpot = a.inputSpots?.[arc.to.port];

      if (o.consume?.includes(inPath)) {
        push(this.step(i, inSpot, inSpot));
        return this.done(id, where, type, origin, { kind: "consume", node: arc.to.node, port: arc.to.port }, segments, arcs);
      }
      const out = Object.entries(o.map ?? {}).find(([, src]) => src === inPath)?.[0];
      if (!out) {
        const how = o.transform ? "an Array transform, which the viewer does not follow" : "no declaration";
        throw new Untraceable(`${portName(arc.to.node, arc.to.port)}: ${how}`);
      }
      const outPort = out.slice("outputs.".length);
      push(this.step(i, inSpot, a.outputSpots?.[outPort]));
      at = { node: arc.to.node, port: outPort };
    }
  }

  private step(i: number, from: SpotRef | undefined, to: SpotRef | undefined): Segment {
    const a = this.scene.activities[i] as ProcessingActivity;
    const kind = accessesDevices(a, this.scene.env) ? "processing" : "resting";
    return { kind, start: a.start, end: a.end, from, to, activity: i };
  }

  private done(
    id: string,
    where: string,
    type: string,
    origin: Origin,
    fate: Fate,
    segments: Segment[],
    arcs: string[],
  ): ObjectTrace {
    const activities = segments.flatMap((s) => (s.activity === undefined ? [] : [s.activity]));
    return { id, label: type ? `${type} · ${where}` : where, type, origin, fate, segments, arcs, activities };
  }

  private onlyStep(key: string, list: readonly number[] | undefined): number {
    if (!list?.length) throw new Untraceable(`the plan has no step at ${key}`);
    if (list.length > 1) throw new Untraceable(`the plan has ${list.length} steps at ${key}`);
    return list[0]!;
  }

  private atomicAt(path: NodePath): AtomicProcess {
    let def: ProcessDef | undefined = this.wf.processes[this.wf.entry];
    for (const id of path) {
      if (def?.kind !== "composite") break;
      const inv = def.body.nodes.find((n) => n.id === id);
      def = inv ? this.wf.processes[inv.process] : undefined;
    }
    if (def?.kind !== "atomic") throw new Untraceable(`${path.join(".")} is not an atomic step of the workflow`);
    return def;
  }
}
