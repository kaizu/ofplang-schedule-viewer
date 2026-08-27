/**
 * The corpus the golden tests read: everything the pinned submodule ships.
 *
 * Discovered by globbing rather than listed by hand, so raising the pin picks
 * up new examples without an edit here (design.md D6). The trade is that a pin
 * which stopped shipping examples would pass silently — each test file asserts
 * a floor on the count to catch that.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = (rel: string): string =>
  fileURLToPath(new URL(`../../../external/ofplang-schedule/${rel}`, import.meta.url));

export const EXAMPLES = root("examples");
export const OUTPUTS = root("examples/outputs");

const listing = (dir: string, suffix: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort();

export const read = (dir: string, name: string): string => readFileSync(join(dir, name), "utf8");

/** Execution documents: plans and replans (§6). */
export const documentFiles = [
  ...listing(OUTPUTS, ".plan.yaml").map((f) => [OUTPUTS, f] as const),
  ...listing(OUTPUTS, ".replan.yaml").map((f) => [OUTPUTS, f] as const),
];

/** Status inputs live beside the sources, not in outputs (§7). */
export const statusFiles = listing(EXAMPLES, ".status.yaml").map((f) => [EXAMPLES, f] as const);

/** Planning-input documents: `interface` / `inventories` with no activities. */
export const inputDocumentFiles = listing(EXAMPLES, ".document.yaml").map(
  (f) => [EXAMPLES, f] as const,
);

export const workflowFiles = [
  ...listing(EXAMPLES, ".workflow.yaml").map((f) => [EXAMPLES, f] as const),
  ...listing(OUTPUTS, ".workflow.yaml").map((f) => [OUTPUTS, f] as const),
];

export const environmentFiles = [
  ...listing(EXAMPLES, ".env.yaml").map((f) => [EXAMPLES, f] as const),
  ...listing(OUTPUTS, ".env.yaml").map((f) => [OUTPUTS, f] as const),
];

/**
 * Complete triples — a workflow, an environment and a plan that belong
 * together. Built by name, and only kept when all three exist, so an example
 * that ships only some of its parts is skipped rather than mismatched.
 */
export interface Triple {
  readonly name: string;
  readonly workflow: readonly [string, string];
  readonly environment: readonly [string, string];
  readonly plan: readonly [string, string];
}

export const triples: Triple[] = (() => {
  const find = (
    files: readonly (readonly [string, string])[],
    name: string,
    suffix: string,
  ): readonly [string, string] | undefined => files.find(([, f]) => f === `${name}${suffix}`);

  const names = [...new Set(documentFiles.map(([, f]) => f.replace(/\.plan\.yaml$/, "")))].filter(
    (n) => !n.endsWith(".replan.yaml"),
  );

  const out: Triple[] = [];
  for (const name of names) {
    const w = find(workflowFiles, name, ".workflow.yaml");
    const e = find(environmentFiles, name, ".env.yaml");
    const p = find(documentFiles, name, ".plan.yaml");
    if (w && e && p) out.push({ name, workflow: w, environment: e, plan: p });
  }
  return out;
})();
