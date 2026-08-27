/**
 * Identifiers and references shared by the environment definition, the
 * execution document and the workflow.
 *
 * Spec references are to `external/ofplang-schedule/docs/SPECIFICATIONS.md`
 * unless marked "workflow spec", which means `ofplang-spec/SPECIFICATION.md`.
 */

/** A qualified spot, `<device>.<spot>`. Neither part contains a `.` (§8). */
export type SpotRef = string;

export type DeviceId = string;
export type TransporterId = string;

/** A qualified resource, `<device>.<resource>` (§8.2). */
export type ResourceRef = string;

/**
 * A node path: node ids from the entry composite's body down to the atomic
 * node invoked (§6.3).
 *
 * The empty path denotes the entry composite itself — the workflow interface.
 * A boundary transport's arc uses it on the side that touches the interface
 * (§6.4), and it cannot collide with an atomic node, which always has a
 * non-empty path.
 */
export type NodePath = readonly string[];

/** Index key for a node path. `.` never occurs inside an identifier (§8.1). */
export const pathKey = (p: NodePath): string => p.join(".");

/** The device half of a qualified spot. */
export const deviceOf = (spot: SpotRef): DeviceId => {
  const i = spot.indexOf(".");
  return i < 0 ? spot : spot.slice(0, i);
};

/** The spot half of a qualified spot. */
export const spotNameOf = (spot: SpotRef): string => {
  const i = spot.indexOf(".");
  return i < 0 ? "" : spot.slice(i + 1);
};

/** One end of an Object-bearing arc (§6.4). */
export interface PortRef {
  readonly node: NodePath;
  readonly port: string;
}

/** The logical connection a transport serves (§6.4). */
export interface ArcRef {
  readonly from: PortRef;
  readonly to: PortRef;
}

/** True when this end of an arc is the workflow interface rather than a node. */
export const isBoundary = (e: PortRef): boolean => e.node.length === 0;

/** Stable key for an arc, so every leg of a multi-hop move shares one key. */
export const arcKey = (a: ArcRef): string =>
  `${pathKey(a.from.node)}|${a.from.port}>${pathKey(a.to.node)}|${a.to.port}`;
