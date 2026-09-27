/**
 * The workflow — ofplang v0 (workflow spec).
 *
 * Only the subset this viewer reads: types, atomic and composite processes,
 * node invocations and their bindings. `$import`, generics and structured
 * nodes are out of scope and are refused by the feature gate (design.md D10).
 */

export interface PortDecl {
  readonly type: string;
  readonly phase: string;
}

/** A binding source, e.g. `"Heat.out"` or `"inputs.sample"`. */
export interface Binding {
  readonly from: string;
}

/** workflow spec §14. */
export interface ObjectsSection {
  readonly map?: Readonly<Record<string, string>>;
  readonly consume?: readonly string[];
  readonly create?: readonly string[];
  readonly transform?: unknown;
}

export interface AtomicProcess {
  readonly kind: "atomic";
  readonly inputs: Readonly<Record<string, PortDecl>>;
  readonly outputs: Readonly<Record<string, PortDecl>>;
  readonly objects?: ObjectsSection;
  /**
   * workflow spec §15, as written. `object_identity_map` is the only marker
   * v0 defines; where `objects` is absent it implies a `map` (`objectsOf`).
   */
  readonly behavior?: readonly string[];
}

export interface NodeInvocation {
  readonly id: string;
  readonly process: string;
  /** Object-bearing bindings. */
  readonly state: Readonly<Record<string, Binding>>;
  /** Pure Data bindings — the node's `bind` section (workflow spec §11). */
  readonly data: Readonly<Record<string, Binding>>;
}

export interface CompositeProcess {
  readonly kind: "composite";
  readonly inputs: Readonly<Record<string, PortDecl>>;
  readonly outputs: Readonly<Record<string, PortDecl>>;
  readonly body: {
    readonly nodes: readonly NodeInvocation[];
    readonly returns: Readonly<Record<string, Binding>>;
  };
}

export type ProcessDef = AtomicProcess | CompositeProcess;

export interface Workflow {
  readonly specVersion: string;
  readonly types: Readonly<Record<string, { readonly domain: "object" | "data" }>>;
  readonly processes: Readonly<Record<string, ProcessDef>>;
  readonly entry: string;
}
