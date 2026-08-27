/**
 * The workflow as a tree of node invocations.
 *
 * This is the *source* structure, not the expanded one (design.md D11): a
 * composite is one box until someone opens it, and it says how many atomic
 * steps are inside. Twenty copies of the same unit read as "×20", which is
 * what a person wants when the plan is being explained to them; the way down
 * to the individual copies stays one click away.
 */

import { pathKey, type NodePath } from "./common";
import type { Workflow } from "./workflow";

export interface Binding {
  /** `"<sibling>.<port>"` or `"inputs.<port>"`. */
  readonly from: string;
  /** True for an Object-bearing binding (`state`), false for Pure Data. */
  readonly object: boolean;
}

export interface GraphNode {
  /** The invocation's own id; empty for the entry composite. */
  readonly id: string;
  readonly path: NodePath;
  readonly key: string;
  readonly process: string;
  readonly kind: "atomic" | "composite";
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  /** This node's own inbound bindings, by the port they land on. */
  readonly bindings: Readonly<Record<string, Binding>>;
  /** A composite's outputs, by the child port each is returned from. */
  readonly returns: Readonly<Record<string, string>>;
  readonly children: readonly GraphNode[];
  /** Atomic steps at or below this node — the badge on a closed composite. */
  readonly atomicCount: number;
}

export function buildGraph(wf: Workflow): GraphNode {
  const make = (
    path: NodePath,
    id: string,
    process: string,
    bindings: Record<string, Binding>,
  ): GraphNode => {
    const def = wf.processes[process];
    const inputs = Object.keys(def?.inputs ?? {});
    const outputs = Object.keys(def?.outputs ?? {});

    if (!def || def.kind === "atomic") {
      return {
        id, path, key: pathKey(path), process,
        kind: "atomic", inputs, outputs, bindings, returns: {},
        children: [], atomicCount: 1,
      };
    }

    const children = def.body.nodes.map((inv) => {
      const b: Record<string, Binding> = {};
      for (const [port, src] of Object.entries(inv.state)) b[port] = { from: src.from, object: true };
      for (const [port, src] of Object.entries(inv.data)) b[port] = { from: src.from, object: false };
      return make(path.concat(inv.id), inv.id, inv.process, b);
    });

    const returns: Record<string, string> = {};
    for (const [port, src] of Object.entries(def.body.returns)) returns[port] = src.from;

    return {
      id, path, key: pathKey(path), process,
      kind: "composite", inputs, outputs, bindings, returns, children,
      atomicCount: children.reduce((n, c) => n + c.atomicCount, 0),
    };
  };

  return make([], wf.entry, wf.entry, {});
}

/** Find a node by its index key. */
export function findNode(root: GraphNode, key: string): GraphNode | undefined {
  if (root.key === key) return root;
  for (const child of root.children) {
    const hit = findNode(child, key);
    if (hit) return hit;
  }
  return undefined;
}

/** Every composite below the root — what "expand all" opens. */
export function compositeKeys(root: GraphNode): string[] {
  const out: string[] = [];
  const walk = (n: GraphNode): void => {
    if (n.kind === "composite" && n.key !== "") out.push(n.key);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * The box that stands for a node path on screen.
 *
 * A path into a closed composite is represented by that composite, which is
 * what makes the highlight work at any depth: the plan always names the atomic
 * node, and the graph may be showing its grandparent.
 */
export function visibleFor(
  root: GraphNode,
  path: NodePath,
  expanded: ReadonlySet<string>,
): string | undefined {
  const isOpen = (n: GraphNode): boolean =>
    n.kind === "composite" && (n.key === "" || expanded.has(n.key));

  if (path.length === 0) return root.key;

  let node = root;
  for (const id of path) {
    if (!isOpen(node)) return node.key;
    const next = node.children.find((c) => c.id === id);
    if (!next) return node.key;
    node = next;
  }
  return node.key;
}

/** The keys of every box between the root and this one, exclusive. */
export function ancestorKeys(path: NodePath): string[] {
  const out: string[] = [];
  for (let i = 1; i < path.length; i++) out.push(pathKey(path.slice(0, i)));
  return out;
}
