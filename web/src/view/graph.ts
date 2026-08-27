/**
 * Draw the workflow graph as SVG.
 *
 * Z-order is the whole trick: an open container's fill would bury the edges
 * running through it, so the shells go down first, the edges over them, and
 * the boxes people click on last.
 */

import { GRAPH_METRICS, layoutGraph, type GraphLayout, type LaidNode } from "../layout/graph";
import type { GraphNode } from "../model/graph";

const { HEADER_H, PORT_ROW, BOX_HEADER } = GRAPH_METRICS;

export interface GraphOptions {
  readonly expanded: ReadonlySet<string>;
  /** Boxes to emphasise; everything else recedes. Empty = no selection. */
  readonly lit: ReadonlySet<string>;
  /** Boxes on the way to a lit one — outlined, not filled. */
  readonly onPath: ReadonlySet<string>;
}

export interface GraphRender {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function renderGraph(root: GraphNode, opts: GraphOptions): GraphRender {
  const layout: GraphLayout = layoutGraph(root, opts.expanded);
  const active = opts.lit.size > 0;

  const classesFor = (n: LaidNode): string =>
    [
      "gnode",
      n.node.kind,
      n.open ? "open" : "shut",
      opts.lit.has(n.key) ? "lit" : "",
      opts.onPath.has(n.key) ? "on-path" : "",
      active && !opts.lit.has(n.key) && !opts.onPath.has(n.key) ? "dim" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const shells = layout.shells.map((n) => shell(n, classesFor(n))).join("");
  const leaves = layout.leaves.map((n) => leaf(n, classesFor(n))).join("");

  const edges = layout.edges
    .map((e) => {
      const on = opts.lit.has(e.fromKey) || opts.lit.has(e.toKey);
      const cls = ["edge", e.object ? "" : "data", on ? "lit" : "", active && !on ? "dim" : ""]
        .filter(Boolean)
        .join(" ");
      const dx = Math.max(24, (e.to.x - e.from.x) / 2);
      const d = `M ${r(e.from.x)} ${r(e.from.y)} C ${r(e.from.x + dx)} ${r(e.from.y)}, ${r(e.to.x - dx)} ${r(e.to.y)}, ${r(e.to.x)} ${r(e.to.y)}`;
      const head = `<path class="arrow${on ? " lit" : ""}${active && !on ? " dim" : ""}" d="M ${r(e.to.x)} ${r(e.to.y)} l -5.5 -2.8 l 0 5.6 z"/>`;
      return `<path class="${cls}" d="${d}"/>${head}`;
    })
    .join("");

  return {
    svg: shells + edges + leaves,
    width: layout.width + 4,
    height: layout.height + 4,
  };
}

const r = (n: number): number => Math.round(n * 10) / 10;

function shell(n: LaidNode, cls: string): string {
  const parts = [`<g class="${cls}" data-key="${esc(n.key)}" transform="translate(${r(n.x)},${r(n.y)})">`];
  parts.push(`<rect class="box" width="${r(n.w)}" height="${r(n.h)}"/>`);
  parts.push(`<text class="nid" x="11" y="16">${esc(n.node.id || n.node.process)}</text>`);
  parts.push(
    `<text class="nsub" x="${r(n.w) - 11}" y="16" text-anchor="end">${esc(n.node.process)} · ${n.node.atomicCount} steps</text>`,
  );
  parts.push(`<line class="rule" x1="0" y1="${BOX_HEADER}" x2="${r(n.w)}" y2="${BOX_HEADER}"/>`);
  if (n.node.key !== "")
    parts.push(`<text class="chev" x="11" y="${r(n.h) - 8}">▾ close</text>`);
  parts.push(ports(n));
  parts.push("</g>");
  return parts.join("");
}

function leaf(n: LaidNode, cls: string): string {
  const parts = [`<g class="${cls}" data-key="${esc(n.key)}" transform="translate(${r(n.x)},${r(n.y)})">`];
  parts.push(`<rect class="box" width="${r(n.w)}" height="${r(n.h)}"/>`);
  parts.push(`<text class="nid" x="10" y="15">${esc(clip(n.node.id, 15))}</text>`);

  if (n.node.kind === "composite") {
    // The badge is the affordance and the count at once (D11).
    const w = 40;
    parts.push(`<rect class="badge" x="${r(n.w) - w - 8}" y="4" width="${w}" height="14" rx="3"/>`);
    parts.push(
      `<text class="btext" x="${r(n.w) - w / 2 - 8}" y="14.5" text-anchor="middle">▸ ×${n.node.atomicCount}</text>`,
    );
  } else if (n.node.process !== n.node.id) {
    parts.push(
      `<text class="nsub" x="${r(n.w) - 9}" y="15" text-anchor="end">${esc(clip(n.node.process, 16))}</text>`,
    );
  }

  parts.push(`<line class="rule" x1="0" y1="${HEADER_H - 4}" x2="${r(n.w)}" y2="${HEADER_H - 4}"/>`);
  parts.push(ports(n));
  parts.push("</g>");
  return parts.join("");
}

function ports(n: LaidNode): string {
  const out: string[] = [];
  const label = n.open ? 11 : 12;
  for (const a of n.inputs) {
    const y = r(a.y - n.y);
    out.push(`<circle class="pdot" cx="0" cy="${y}" r="2.6"/>`);
    out.push(`<text class="pname" x="7" y="${y + 3}">${esc(clip(a.port, label))}</text>`);
  }
  for (const a of n.outputs) {
    const y = r(a.y - n.y);
    out.push(`<circle class="pdot" cx="${r(n.w)}" cy="${y}" r="2.6"/>`);
    out.push(
      `<text class="pname" x="${r(n.w) - 7}" y="${y + 3}" text-anchor="end">${esc(clip(a.port, label))}</text>`,
    );
  }
  return out.join("");
}

export const GRAPH_ROW = PORT_ROW;
