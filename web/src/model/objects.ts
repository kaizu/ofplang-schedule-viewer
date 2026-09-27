/**
 * Objects — which physical thing is which, across a plan.
 *
 * The plan names no Object: it has arcs (§6.4), and each atomic process says
 * what becomes of the Objects at its ports (workflow spec §14). Chaining arcs
 * through those declarations is what tells one plate from another
 * (design.md D57).
 */

import { carriesObject } from "./graph";
import type { AtomicProcess, ObjectsSection, Workflow } from "./workflow";

export const OBJECT_IDENTITY_MAP = "object_identity_map";

/**
 * The Object behaviour an atomic process has — written, or inferred.
 *
 * workflow spec §15: only where `objects` is omitted altogether does the
 * `object_identity_map` marker imply one; it maps every Object-bearing input
 * to the Object-bearing output of the same name, type and phase. A written
 * section is taken as it stands, marker or not — no implicit completion. A
 * port the inference cannot pair is left without a fate, as the spec leaves
 * it; tracing a plan reports it rather than guessing.
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
