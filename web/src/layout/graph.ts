/**
 * Lay the workflow out left to right, containers nested in place.
 *
 * A layered layout rather than a library: the graphs here are dataflow, so the
 * layer of a node is one past the deepest sibling it reads from, and that is
 * the whole algorithm. Ports get their own anchors because an arc between two
 * multi-port steps is ambiguous otherwise (D19), and a closed composite keeps
 * the ports of the process it stands for, so an edge into it lands somewhere
 * meaningful whether it is open or shut.
 *
 * Pure: no DOM, no colours. Positions are absolute, in one coordinate space.
 */

import type { GraphNode } from "../model/graph";

export const NODE_W = 178;
const HEADER_H = 22;
const PORT_ROW = 15;
const NODE_PAD_B = 7;
const GAP_X = 58;
const GAP_Y = 18;
const BOX_PAD = 14;
const BOX_HEADER = 25;
/** Room inside a container's border for its own port labels. */
const PORT_GUTTER = 78;

export interface Anchor {
  readonly port: string;
  readonly x: number;
  readonly y: number;
}

export interface LaidNode {
  readonly node: GraphNode;
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly open: boolean;
  readonly depth: number;
  readonly inputs: readonly Anchor[];
  readonly outputs: readonly Anchor[];
}

export interface LaidEdge {
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
  readonly object: boolean;
  readonly fromKey: string;
  readonly toKey: string;
}

export interface GraphLayout {
  readonly width: number;
  readonly height: number;
  /** Open containers, outermost first — drawn under the edges. */
  readonly shells: readonly LaidNode[];
  /** Closed boxes and atomic steps — drawn over the edges. */
  readonly leaves: readonly LaidNode[];
  readonly edges: readonly LaidEdge[];
}

interface Sized {
  readonly node: GraphNode;
  readonly open: boolean;
  readonly w: number;
  readonly h: number;
  /** Relative to this node's own origin. */
  readonly placed: { readonly sized: Sized; readonly x: number; readonly y: number }[];
}

export function layoutGraph(root: GraphNode, expanded: ReadonlySet<string>): GraphLayout {
  const sized = measure(root, expanded);

  const shells: LaidNode[] = [];
  const leaves: LaidNode[] = [];
  const edges: LaidEdge[] = [];

  const place = (s: Sized, ox: number, oy: number, depth: number): void => {
    const laid: LaidNode = {
      node: s.node,
      key: s.node.key,
      x: ox,
      y: oy,
      w: s.w,
      h: s.h,
      open: s.open,
      depth,
      inputs: inputAnchors(s).map((a) => ({ ...a, x: a.x + ox, y: a.y + oy })),
      outputs: outputAnchors(s).map((a) => ({ ...a, x: a.x + ox, y: a.y + oy })),
    };
    (s.open ? shells : leaves).push(laid);
    if (!s.open) return;

    const byId = new Map(s.placed.map((p) => [p.sized.node.id, p]));
    const anchorsOf = (p: { sized: Sized; x: number; y: number }) => ({
      inputs: inputAnchors(p.sized).map((a) => ({ ...a, x: a.x + ox + p.x, y: a.y + oy + p.y })),
      outputs: outputAnchors(p.sized).map((a) => ({ ...a, x: a.x + ox + p.x, y: a.y + oy + p.y })),
    });

    for (const p of s.placed) {
      const target = anchorsOf(p);
      for (const [port, binding] of Object.entries(p.sized.node.bindings)) {
        const to = target.inputs.find((a) => a.port === port);
        if (!to) continue;

        const dot = binding.from.indexOf(".");
        const head = dot < 0 ? binding.from : binding.from.slice(0, dot);
        const tail = dot < 0 ? "" : binding.from.slice(dot + 1);

        let from: Anchor | undefined;
        let fromKey: string;
        if (head === "inputs") {
          // The container's own inbound port, on its left border.
          from = laid.inputs.find((a) => a.port === tail);
          fromKey = laid.key;
        } else {
          const src = byId.get(head);
          if (!src) continue;
          from = anchorsOf(src).outputs.find((a) => a.port === tail);
          fromKey = src.sized.node.key;
        }
        if (!from) continue;
        edges.push({
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
          object: binding.object,
          fromKey,
          toKey: p.sized.node.key,
        });
      }
    }

    // What the container hands back out, drawn to its right border.
    for (const [port, source] of Object.entries(s.node.returns)) {
      const dot = source.indexOf(".");
      if (dot < 0) continue;
      const src = byId.get(source.slice(0, dot));
      const to = laid.outputs.find((a) => a.port === port);
      if (!src || !to) continue;
      const from = anchorsOf(src).outputs.find((a) => a.port === source.slice(dot + 1));
      if (!from) continue;
      edges.push({
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        object: true,
        fromKey: src.sized.node.key,
        toKey: laid.key,
      });
    }

    for (const p of s.placed) place(p.sized, ox + p.x, oy + p.y, depth + 1);
  };

  place(sized, 0, 0, 0);

  return { width: sized.w, height: sized.h, shells, leaves, edges };
}

/** Size a node and, if it is open, place its children inside it. */
function measure(node: GraphNode, expanded: ReadonlySet<string>): Sized {
  const open = node.kind === "composite" && (node.key === "" || expanded.has(node.key));

  if (!open) {
    const rows = Math.max(node.inputs.length, node.outputs.length, 1);
    return { node, open, w: NODE_W, h: HEADER_H + rows * PORT_ROW + NODE_PAD_B, placed: [] };
  }

  const children = node.children.map((c) => measure(c, expanded));
  const byId = new Map(children.map((c) => [c.node.id, c]));

  // Layer = one past the deepest sibling this node reads from.
  const layer = new Map<string, number>();
  const depthOf = (c: Sized, seen: Set<string>): number => {
    const known = layer.get(c.node.id);
    if (known !== undefined) return known;
    if (seen.has(c.node.id)) return 0; // a cycle is not valid v0; do not hang on one
    seen.add(c.node.id);
    let d = 0;
    for (const binding of Object.values(c.node.bindings)) {
      const dot = binding.from.indexOf(".");
      const head = dot < 0 ? binding.from : binding.from.slice(0, dot);
      const src = byId.get(head);
      if (src && src !== c) d = Math.max(d, depthOf(src, seen) + 1);
    }
    layer.set(c.node.id, d);
    return d;
  };
  for (const c of children) depthOf(c, new Set());

  const columns: Sized[][] = [];
  for (const c of children) {
    const d = layer.get(c.node.id) ?? 0;
    (columns[d] ??= []).push(c);
  }

  const left = BOX_PAD + (node.inputs.length ? PORT_GUTTER : 0);
  const right = BOX_PAD + (Object.keys(node.returns).length ? PORT_GUTTER : 0);

  let x = left;
  let tallest = 0;
  const geometry: { column: Sized[]; x: number; w: number; h: number }[] = [];
  for (const column of columns) {
    if (!column?.length) continue;
    const w = Math.max(...column.map((c) => c.w));
    const h = column.reduce((sum, c) => sum + c.h, 0) + GAP_Y * (column.length - 1);
    geometry.push({ column, x, w, h });
    tallest = Math.max(tallest, h);
    x += w + GAP_X;
  }

  const contentW = Math.max(x - GAP_X - left, 60);
  const contentH = Math.max(tallest, 44);

  const placed: Sized["placed"] = [];
  for (const g of geometry) {
    let y = BOX_HEADER + BOX_PAD + (contentH - g.h) / 2;
    for (const c of g.column) {
      placed.push({ sized: c, x: g.x + (g.w - c.w) / 2, y });
      y += c.h + GAP_Y;
    }
  }

  return {
    node,
    open,
    w: left + contentW + right,
    h: BOX_HEADER + BOX_PAD * 2 + contentH,
    placed,
  };
}

function inputAnchors(s: Sized): Anchor[] {
  if (!s.open)
    return s.node.inputs.map((port, i) => ({ port, x: 0, y: HEADER_H + i * PORT_ROW + PORT_ROW / 2 }));
  const n = s.node.inputs.length;
  return s.node.inputs.map((port, i) => ({
    port,
    x: 0,
    y: BOX_HEADER + ((s.h - BOX_HEADER) * (i + 1)) / (n + 1),
  }));
}

function outputAnchors(s: Sized): Anchor[] {
  if (!s.open)
    return s.node.outputs.map((port, i) => ({
      port,
      x: s.w,
      y: HEADER_H + i * PORT_ROW + PORT_ROW / 2,
    }));
  const ports = Object.keys(s.node.returns);
  return ports.map((port, i) => ({
    port,
    x: s.w,
    y: BOX_HEADER + ((s.h - BOX_HEADER) * (i + 1)) / (ports.length + 1),
  }));
}

export const GRAPH_METRICS = { NODE_W, HEADER_H, PORT_ROW, BOX_HEADER, BOX_PAD };
