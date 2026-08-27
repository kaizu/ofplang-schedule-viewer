/** The right-hand panel: the plan at a glance, or the selected activity. */

import { arcKey, pathKey } from "../model/common";
import { findNode, type GraphNode } from "../model/graph";
import { activitiesUnder } from "../model/scene";
import type { Activity } from "../model/document";
import type { Scene } from "../model/scene";
import { formatDuration, unitAbbrev } from "../layout/scale";
import { activityLabel } from "../layout/gantt";

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const dl = (rows: readonly (readonly [string, unknown])[]): string =>
  `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;

const block = (title: string, body: string): string => `<div><h3>${esc(title)}</h3>${body}</div>`;

export function renderInspector(scene: Scene, selected: number | undefined, datasetBlurb: string): string {
  return selected === undefined
    ? overview(scene, datasetBlurb)
    : detail(scene, selected);
}

function overview(scene: Scene, blurb: string): string {
  const { doc, metrics, unit } = scene;
  const obj = doc.objective;
  const fmtObjective = (): string => {
    if (!obj) return "—";
    const kinds = Array.isArray(obj.kind) ? obj.kind : [obj.kind];
    const values = Array.isArray(obj.value) ? obj.value : obj.value === undefined ? [] : [obj.value];
    return kinds.map((k, i) => `${k} = ${values[i] ?? "?"}`).join(", ");
  };

  const out: string[] = [];
  if (blurb) out.push(block("Dataset", `<div class="note">${esc(blurb)}</div>`));

  out.push(
    block(
      "Solve",
      dl([
        ["outcome", doc.outcome ?? "—"],
        ["objective", fmtObjective()],
        ["makespan", formatDuration(metrics.makespan, unit)],
        ...(typeof doc.now === "number"
          ? ([["now", formatDuration(doc.now, unit)]] as const)
          : []),
      ]),
    ),
  );

  const counts = metrics.counts;
  out.push(
    block(
      "Activities",
      dl(
        (["processing", "transport", "relay", "replenishment"] as const)
          .filter((k) => counts[k] > 0)
          .map((k) => [k, counts[k]] as const),
      ),
    ),
  );

  if (metrics.busiest.length) {
    const bars = metrics.busiest
      .map(
        (m) =>
          `<div class="ubar"><span class="t" title="${esc(m.id)}">${esc(m.id)}</span>` +
          `<span class="track"><span class="fill ${esc(m.kind)}" style="width:${Math.round(m.occupancy * 100)}%"></span></span>` +
          `<span class="p num">${Math.round(m.occupancy * 100)}%</span></div>`,
      )
      .join("");
    out.push(
      block(
        "Occupancy",
        `<div class="util">${bars}</div>` +
          `<div class="note" style="margin-top:8px">Share of the run each machine is held. A move holds its ` +
          `transporter and the devices at both ends, so those count too.</div>`,
      ),
    );
  }

  if (doc.interface) {
    const rows = [
      ...Object.entries(doc.interface.inputs).map(([p, s]) => [`in · ${p}`, s] as const),
      ...Object.entries(doc.interface.outputs ?? {}).map(([p, s]) => [`out · ${p}`, s] as const),
    ];
    if (rows.length)
      out.push(block("Boundary", dl(rows) + `<div class="note" style="margin-top:8px">Where the workflow's own material starts and ends up.</div>`));
  }

  if (scene.resources.length) {
    // The question a plan with refills raises is why this many and why here.
    // Where it got to at its lowest is the answer: a stock that reaches zero
    // was the constraint, one that never drops far was not.
    const rows = scene.resources
      .map((r) => {
        const cap = r.capacity === undefined ? "" : ` / ${r.capacity}`;
        const drained = r.low === 0 ? ' <span class="warn">ran dry</span>' : "";
        return (
          `<div class="ubar res"><span class="t" title="${esc(r.ref)}">${esc(r.ref)}</span>` +
          `<span class="p num">${r.start} → ${r.low}${drained} → ${r.end}${cap}</span></div>`
        );
      })
      .join("");
    const refills = scene.resources.reduce((n, r) => n + r.refills, 0);
    out.push(
      block(
        "Stock",
        `<div class="util">${rows}</div>` +
          `<div class="note" style="margin-top:8px">Level at the start, at its lowest once the run was ` +
          `under way, and at the end, replayed from the ` +
          `starting stock through ${refills === 1 ? "one refill" : `${refills} refills`} and what each step used.</div>`,
      ),
    );
  }

  return out.join("");
}

function detail(scene: Scene, index: number): string {
  const a = scene.activities[index];
  if (!a) return "";
  const unit = scene.unit;
  const out: string[] = [];

  out.push(`<div><h3>${esc(a.kind)}</h3><div class="lead">${esc(activityLabel(a))}</div></div>`);

  const timing: (readonly [string, unknown])[] = [
    ["start", formatDuration(a.start, unit)],
    ["end", formatDuration(a.end, unit)],
    ["duration", formatDuration(a.end - a.start, unit)],
  ];
  if (a.status !== "pending") timing.push(["status", a.status]);
  out.push(block("Timing", dl(timing)));

  switch (a.kind) {
    case "processing": {
      const rows: (readonly [string, unknown])[] = [
        ["process", a.process],
        ["mode", a.mode],
        ["node", pathKey(a.node)],
      ];
      if (a.devices?.length) rows.push(["devices", a.devices.join(", ")]);
      for (const [p, s] of Object.entries(a.inputSpots ?? {})) rows.push([`in · ${p}`, s]);
      for (const [p, s] of Object.entries(a.outputSpots ?? {})) rows.push([`out · ${p}`, s]);
      for (const [r, n] of Object.entries(a.consumption ?? {})) rows.push([`uses · ${r}`, n]);
      out.push(block("Step", dl(rows)));
      break;
    }
    case "transport":
      out.push(
        block(
          "Move",
          dl([
            ["from", a.fromSpot],
            ["to", a.toSpot],
            // §6.4: omitted for a same-spot move, which no transporter performs.
            ["transporter", a.transporter ?? "— (same spot, a no-op)"],
            ...(a.seq !== undefined ? ([["leg", a.seq]] as const) : []),
          ]),
        ),
      );
      break;
    case "relay":
      out.push(block("Junction", dl([["spot", a.spot], ["leg", a.seq]])));
      break;
    case "replenishment":
      out.push(
        block(
          "Refill",
          dl([
            ["device", a.device],
            ["replenisher", a.replenisher],
            ...Object.entries(a.amounts).map(([r, n]) => [`+ ${r}`, n] as const),
          ]),
        ),
      );
      break;
  }

  if (a.kind === "transport" || a.kind === "relay") {
    const end = (e: { node: readonly string[]; port: string }): string =>
      `${e.node.length ? e.node.join("/") : "⟨interface⟩"} . ${e.port}`;
    const legs = scene.byArc.get(arcKey(a.arc)) ?? [];
    out.push(
      block(
        "Object arc",
        dl([
          ["from", end(a.arc.from)],
          ["to", end(a.arc.to)],
          ["legs", legs.length],
        ]) +
          `<div class="note" style="margin-top:8px">Every leg of a multi-hop move carries this same arc — selecting one selects the whole journey.</div>`,
      ),
    );
  }

  return out.join("");
}

/** The hover card. */
export function tooltipFor(scene: Scene, index: number): string {
  const a = scene.activities[index];
  if (!a) return "";
  const unit = unitAbbrev(scene.unit);
  const lines: string[] = [`${a.start} – ${a.end} ${unit}  (${a.end - a.start})`];
  if (a.kind === "processing")
    lines.push(`${a.process} · mode ${a.mode}${a.devices?.length ? ` · ${a.devices.join(", ")}` : ""}`);
  if (a.kind === "transport")
    lines.push(`${a.fromSpot} → ${a.toSpot}${a.transporter ? ` · ${a.transporter}` : " · same spot"}`);
  if (a.kind === "relay") lines.push(`waiting at ${a.spot}`);
  if (a.kind === "replenishment") lines.push(`${a.device} · ${a.replenisher}`);
  if (a.status !== "pending") lines.push(`status: ${a.status}`);
  return `<div class="tt">${esc(activityLabel(a))}</div><div class="tl">${lines.map(esc).join("<br>")}</div>`;
}

export function statusLine(scene: Scene, selected: number | undefined): string {
  if (selected === undefined) return "Nothing selected — click a bar";
  const a = scene.activities[selected];
  return a ? `Selected · ${activityLabel(a)}` : "Nothing selected";
}

export type { Activity };


/* ── with no plan loaded ─────────────────────────────────────────────────
   The graph stands on its own: a workflow can be read before anything has
   been scheduled from it, and that is when the feature gate is most useful. */

export function renderWorkflowOverview(graph: GraphNode, blurb: string): string {
  const out: string[] = [];
  if (blurb) out.push(block("Loaded", `<div class="note">${esc(blurb)}</div>`));

  out.push(
    block(
      "Workflow",
      `<div class="lead">${esc(graph.process)}</div>` +
        dl([
          ["atomic steps", graph.atomicCount],
          ["top-level nodes", graph.children.length],
          ["entry inputs", Object.keys(graph.inputs).length],
          ["entry outputs", Object.keys(graph.returns).length],
        ]),
    ),
  );

  out.push(
    block(
      "No plan",
      `<div class="note">Nothing has been scheduled from this workflow yet. ` +
        `Run <code>ofp-schedule schedule</code> on it and drop the plan here to see when each step runs.</div>`,
    ),
  );
  return out.join("");
}

/** A box in the graph: what it is, and what it accounts for in the plan. */
export function renderNodeDetail(graph: GraphNode, key: string, scene?: Scene): string {
  const node = findNode(graph, key);
  if (!node) return "";
  const out: string[] = [];

  out.push(
    `<div><h3>${esc(node.kind)} node</h3><div class="lead">${esc(node.key || node.process)}</div></div>`,
  );

  const rows: (readonly [string, unknown])[] = [["process", node.process]];
  if (node.kind === "composite") {
    rows.push(["atomic steps", node.atomicCount], ["nodes inside", node.children.length]);
  }
  out.push(block("Node", dl(rows)));

  if (node.inputs.length || node.outputs.length)
    out.push(
      block(
        "Ports",
        dl([
          ...node.inputs.map((p) => ["in", p] as const),
          ...node.outputs.map((p) => ["out", p] as const),
        ]),
      ),
    );

  if (scene) {
    const under = activitiesUnder(scene, node.key === "" ? [] : node.key.split("."));
    const acts = under.map((i) => scene.activities[i]!);
    const steps = acts.filter((a) => a.kind === "processing").length;
    const window =
      acts.length > 0
        ? `${Math.min(...acts.map((a) => a.start))} – ${Math.max(...acts.map((a) => a.end))} ${unitAbbrev(scene.unit)}`
        : "—";
    out.push(
      block(
        "In the plan",
        dl([
          ["steps", steps],
          ["moves", acts.length - steps],
          ["window", window],
        ]),
      ),
    );
  }

  return out.join("");
}
