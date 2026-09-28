/**
 * The workflow as a tree of node invocations.
 *
 * This is the *source* structure, not the expanded one (design.md D11): a
 * composite is one box until someone opens it, and it says how many atomic
 * steps are inside. Twenty copies of the same unit read as "×20", which is
 * what a person wants when the plan is being explained to them; the way down
 * to the individual copies stays one click away.
 */

import { pathKey, type ArcRef, type NodePath } from "./common";
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
  /** Declared type of each port, as written (`Plate`, `Float`, `Float[s]`). */
  readonly inputTypes: Readonly<Record<string, string>>;
  readonly outputTypes: Readonly<Record<string, string>>;
  /** This node's own inbound bindings, by the port they land on. */
  readonly bindings: Readonly<Record<string, Binding>>;
  /** Inputs given a literal value instead of a binding (workflow spec 11.1.1). */
  readonly literals: Readonly<Record<string, unknown>>;
  /** A composite's outputs returned as a literal (2.6.6). */
  readonly returnLiterals: Readonly<Record<string, unknown>>;
  /** A composite's outputs, by the child port each is returned from. */
  readonly returns: Readonly<Record<string, string>>;
  /** Whether each returned output carries an Object, from its declared type. */
  readonly returnsObject: Readonly<Record<string, boolean>>;
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
    literals: Readonly<Record<string, unknown>>,
  ): GraphNode => {
    const def = wf.processes[process];
    const inputs = Object.keys(def?.inputs ?? {});
    const outputs = Object.keys(def?.outputs ?? {});
    const typesOf = (ports: Readonly<Record<string, { type: string }>> | undefined) =>
      Object.fromEntries(Object.entries(ports ?? {}).map(([p, d]) => [p, d.type]));
    const inputTypes = typesOf(def?.inputs);
    const outputTypes = typesOf(def?.outputs);

    if (!def || def.kind === "atomic") {
      return {
        id, path, key: pathKey(path), process,
        kind: "atomic", inputs, outputs, inputTypes, outputTypes, bindings, literals, returnLiterals: {},
        returns: {}, returnsObject: {},
        children: [], atomicCount: 1,
      };
    }

    const children = def.body.nodes.map((inv) => {
      const b: Record<string, Binding> = {};
      for (const [port, src] of Object.entries(inv.state)) b[port] = { from: src.from, object: true };
      for (const [port, src] of Object.entries(inv.data)) b[port] = { from: src.from, object: false };
      return make(path.concat(inv.id), inv.id, inv.process, b, inv.literals);
    });

    const returns: Record<string, string> = {};
    const returnsObject: Record<string, boolean> = {};
    for (const [port, src] of Object.entries(def.body.returns)) {
      returns[port] = src.from;
      // `returns` does not split Object from Pure Data the way a node's
      // `state` / `data` does, so the declared type decides. An output whose
      // type is unknown stays an Object, as it was drawn before types were read.
      const type = outputTypes[port];
      returnsObject[port] = type === undefined ? true : carriesObject(type, wf);
    }

    return {
      id, path, key: pathKey(path), process,
      kind: "composite", inputs, outputs, inputTypes, outputTypes, bindings, literals,
      returnLiterals: def.body.returnLiterals, returns, returnsObject, children,
      atomicCount: children.reduce((n, c) => n + c.atomicCount, 0),
    };
  };

  return make([], wf.entry, wf.entry, {}, {});
}

/**
 * Whether a declared type carries an Object: it names a type the workflow
 * declares with `domain: object` (workflow spec: `types`). Built-in primitives
 * (`Int`, `Float`, `String`, …) are Pure Data; so is anything the workflow does
 * not declare. `Array<Plate>` carries Plates, so it counts. A unit suffix
 * (`Float[mg/mL]`) is dropped first: a unit atom may share a type's name.
 */
export function carriesObject(type: string, wf: Pick<Workflow, "types">): boolean {
  const names = type.replace(/\[[^\]]*\]/g, "").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return names.some((name) => wf.types[name]?.domain === "object");
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

/**
 * One drawn connection, as the graph names it: a binding or a return between
 * two boxes, each end the box's key and one of its ports. A container's own
 * border is its key too — an edge from its input, or back out to its output.
 */
export interface EdgeId {
  readonly fromKey: string;
  readonly fromPort: string;
  readonly toKey: string;
  readonly toPort: string;
}

export const edgeKey = (e: EdgeId): string => `${e.fromKey}|${e.fromPort}>${e.toKey}|${e.toPort}`;

/**
 * The connections a plan arc runs along, at every level of nesting.
 *
 * A plan arc joins two atomic steps (§6.4); the graph draws the bindings that
 * get it there — out of a composite by its `returns`, across a body by a
 * sibling binding, into a composite by its `inputs.` binding. Which of them
 * are on screen depends on what is open, so all of them are returned and
 * the view lights the ones it draws. Undefined if the workflow does not lead
 * from one end to the other: the arc is then not this workflow's.
 */
export function arcRoute(root: GraphNode, arc: ArcRef): EdgeId[] | undefined {
  const parents = new Map<string, GraphNode>();
  const walk = (n: GraphNode): void => {
    for (const c of n.children) {
      parents.set(c.key, n);
      walk(c);
    }
  };
  walk(root);

  const route: EdgeId[] = [];
  // Where the Object is: an output of `from`, or — when `from` is the
  // container being searched — that container's own input.
  let container: GraphNode;
  let from: GraphNode;
  let port = arc.from.port;
  if (arc.from.node.length === 0) {
    container = from = root;
  } else {
    const n = findNode(root, pathKey(arc.from.node));
    const parent = n && parents.get(n.key);
    if (!n || !parent) return undefined;
    container = parent;
    from = n;
  }

  // Each step moves one binding; a workflow is finite, so is the route.
  for (let guard = 0; guard < 1000; guard++) {
    const source = from === container ? `inputs.${port}` : `${from.id}.${port}`;
    const next = container.children.find((c) =>
      Object.entries(c.bindings).some(([, b]) => b.object && b.from === source),
    );
    if (next) {
      const toPort = Object.entries(next.bindings).find(([, b]) => b.object && b.from === source)![0];
      route.push({ fromKey: from.key, fromPort: port, toKey: next.key, toPort });
      if (next.kind === "atomic")
        return pathKey(next.path) === pathKey(arc.to.node) && toPort === arc.to.port ? route : undefined;
      container = from = next;
      port = toPort;
      continue;
    }
    const out = from === container ? undefined : Object.entries(container.returns).find(([, src]) => src === source)?.[0];
    if (out === undefined) return undefined;
    route.push({ fromKey: from.key, fromPort: port, toKey: container.key, toPort: out });
    if (container === root) return arc.to.node.length === 0 && arc.to.port === out ? route : undefined;
    from = container;
    container = parents.get(container.key)!;
    port = out;
  }
  return undefined;
}
