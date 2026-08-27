/** The execution environment definition — SPECIFICATIONS.md §5. */

import type { DeviceId, ResourceRef, SpotRef, TransporterId } from "./common";

/** §5.2. */
export interface Device {
  readonly id: DeviceId;
  /** Bare spot names, unique within the device. May be empty (§5.2). */
  readonly spots: readonly string[];
  readonly resources?: Readonly<Record<string, { readonly capacity: number }>>;
}

/** §5.4. A missing (transporter, from, to) entry means the move is impossible. */
export interface Transport {
  readonly transporter: TransporterId;
  readonly from: SpotRef;
  readonly to: SpotRef;
  readonly duration: number;
}

/** §5.5. One way to run a process. */
export interface Mode {
  /** Assigned by position when the environment omits it; the plan uses this id. */
  readonly id: string;
  /** May be empty: a Pure-Data-only mode occupies no device (§5.5). */
  readonly devices: readonly DeviceId[];
  readonly duration: number;
  readonly inputSpots: Readonly<Record<string, SpotRef>>;
  readonly outputSpots: Readonly<Record<string, SpotRef>>;
  readonly consumption?: Readonly<Record<ResourceRef, number>>;
}

/** §5. Keyed by atomic process definition name; capability is per definition. */
export interface Environment {
  readonly time?: { readonly unit: string };
  readonly devices: readonly Device[];
  readonly transporters: readonly { readonly id: TransporterId }[];
  readonly transports: readonly Transport[];
  readonly processes: Readonly<Record<string, { readonly modes: readonly Mode[] }>>;
  readonly replenishers?: readonly { readonly id: string }[];
  /** §5.7. Read but not modelled further yet. */
  readonly replenishments?: readonly unknown[];
}
