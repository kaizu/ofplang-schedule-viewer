/**
 * The execution document — SPECIFICATIONS.md §6.
 *
 * A plan and a status share one schema; only the presence of `status` on the
 * activities separates them (§6.2). One reader serves both.
 */

import type { ArcRef, DeviceId, NodePath, ResourceRef, SpotRef, TransporterId } from "./common";

export type Outcome = "optimal" | "feasible" | "infeasible" | "unknown";

/**
 * §6.2. `failed` and `cancelled` are terminal and appear only in a final
 * status; a document carrying one is not a replanning input.
 */
export type ActivityStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export const TERMINAL_STATUSES: readonly ActivityStatus[] = ["failed", "cancelled"];

/** §6.1 `objective`. Both fields take a scalar or a list, and agree in shape. */
export interface Objective {
  readonly kind: string | readonly string[];
  readonly value?: number | readonly number[];
}

/** §6.8. Boundary Object-bearing material pinned to spots. */
export interface InterfaceBinding {
  readonly inputs: Readonly<Record<string, SpotRef>>;
  readonly outputs?: Readonly<Record<string, SpotRef>>;
}

/** §6.10. Consumable levels as of the start of the run. */
export interface Inventories {
  readonly levels: Readonly<Record<DeviceId, Readonly<Record<string, number>>>>;
}

interface ActivityBase {
  readonly status: ActivityStatus;
  readonly start: number;
  readonly end: number;
  /**
   * Reserved for a later "planned vs actual" overlay (design.md D3).
   * Nothing writes it yet; the reader never populates it.
   */
  readonly actual?: { readonly start: number; readonly end: number; readonly status: ActivityStatus };
}

/** §6.3. */
export interface ProcessingActivity extends ActivityBase {
  readonly kind: "processing";
  readonly process: string;
  readonly mode: string;
  /** Non-empty: an atomic node always has a path (§6.3). */
  readonly node: NodePath;
  readonly devices?: readonly DeviceId[];
  readonly inputSpots?: Readonly<Record<string, SpotRef>>;
  readonly outputSpots?: Readonly<Record<string, SpotRef>>;
  readonly consumption?: Readonly<Record<ResourceRef, number>>;
}

/**
 * §6.4. `transporter` is absent for a same-spot move, which is a physical
 * no-op no transporter performs — the spec calls the field required and then
 * states that exception, so the type has to allow it.
 */
export interface TransportActivity extends ActivityBase {
  readonly kind: "transport";
  readonly fromSpot: SpotRef;
  readonly toSpot: SpotRef;
  readonly transporter?: TransporterId;
  /** Every leg of a multi-leg move carries the same logical arc (§6.4). */
  readonly arc: ArcRef;
  readonly seq?: number;
}

/** §6.4.1. A junction between two legs; instantaneous, so `end === start`. */
export interface RelayActivity extends ActivityBase {
  readonly kind: "relay";
  readonly arc: ArcRef;
  readonly seq: number;
  readonly spot: SpotRef;
}

/** §6.9. Has no `node`: a refill does not come from the workflow (§4.2). */
export interface ReplenishmentActivity extends ActivityBase {
  readonly kind: "replenishment";
  readonly id: string;
  readonly device: DeviceId;
  readonly replenisher: string;
  /** Keyed by bare resource name; the device is already named. */
  readonly amounts: Readonly<Record<string, number>>;
}

export type Activity =
  | ProcessingActivity
  | TransportActivity
  | RelayActivity
  | ReplenishmentActivity;

/** An activity that carries a logical arc — every leg and junction of a move. */
export type ArcActivity = TransportActivity | RelayActivity;

export const hasArc = (a: Activity): a is ArcActivity =>
  a.kind === "transport" || a.kind === "relay";

/** §6.1. */
export interface ExecutionDocument {
  readonly time?: { readonly unit: string };
  /** The reference time of a replan (§6.1). Absent on an initial plan. */
  readonly now?: number;
  readonly interface?: InterfaceBinding;
  readonly inventories?: Inventories;
  readonly outcome?: Outcome;
  readonly objective?: Objective;
  readonly activities: readonly Activity[];
  readonly meta?: { readonly workflow?: string; readonly environment?: string };
}
