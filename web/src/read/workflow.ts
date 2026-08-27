/**
 * Read a workflow — ofplang v0.
 *
 * Only the subset the gate admits (`read/gate.ts`): no `$import`, no generics,
 * no structured nodes. Run the gate first and show its findings; this reader
 * assumes the document got past it and reads the plain shape.
 */

import { parse as parseYaml } from "yaml";

import type {
  AtomicProcess,
  Binding,
  CompositeProcess,
  NodeInvocation,
  ObjectsSection,
  PortDecl,
  ProcessDef,
  Workflow,
} from "../model/workflow";
import {
  at,
  isRecord,
  optRecord,
  optString,
  ReadError,
  reqRecord,
  reqString,
  stringList,
  stringMap,
} from "./coerce";

export function readWorkflowText(text: string): Workflow {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ReadError("", `not valid YAML — ${(e as Error).message}`);
  }
  return readWorkflow(raw);
}

export function readWorkflow(raw: unknown): Workflow {
  const doc = reqRecord(raw, "");

  const types: Record<string, { domain: "object" | "data" }> = {};
  for (const [name, def] of Object.entries(optRecord(doc["types"], "types") ?? {})) {
    const d = reqRecord(def, at("types", name));
    const domain = reqString(d["domain"], at(at("types", name), "domain"));
    if (domain !== "object" && domain !== "data")
      throw new ReadError(at(at("types", name), "domain"), `expected object or data, got "${domain}"`);
    types[name] = { domain };
  }

  const processes: Record<string, ProcessDef> = {};
  for (const [name, def] of Object.entries(reqRecord(doc["processes"], "processes"))) {
    processes[name] = readProcess(def, at("processes", name));
  }

  const entry = reqString(doc["entry"], "entry");
  if (!(entry in processes))
    throw new ReadError("entry", `"${entry}" is not one of the declared processes`);

  return {
    specVersion: optString(doc["spec_version"], "spec_version") ?? "0.0",
    types,
    processes,
    entry,
  };
}

function readProcess(raw: unknown, path: string): ProcessDef {
  const p = reqRecord(raw, path);
  const kind = reqString(p["kind"], at(path, "kind"));
  const inputs = readPorts(p["inputs"], at(path, "inputs"));
  const outputs = readPorts(p["outputs"], at(path, "outputs"));

  if (kind === "atomic") {
    const a: { -readonly [K in keyof AtomicProcess]: AtomicProcess[K] } = {
      kind: "atomic",
      inputs,
      outputs,
    };
    const objects = optRecord(p["objects"], at(path, "objects"));
    if (objects) a.objects = readObjects(objects, at(path, "objects"));
    return a;
  }

  if (kind === "composite") {
    const body = reqRecord(p["body"], at(path, "body"));
    const bodyPath = at(path, "body");
    const rawNodes = body["nodes"];
    const nodes = (Array.isArray(rawNodes) ? rawNodes : []).map((n, i) =>
      readNode(n, at(at(bodyPath, "nodes"), i)),
    );
    const composite: CompositeProcess = {
      kind: "composite",
      inputs,
      outputs,
      body: {
        nodes,
        returns: readBindings(body["returns"], at(bodyPath, "returns")),
      },
    };
    return composite;
  }

  throw new ReadError(at(path, "kind"), `expected atomic or composite, got "${kind}"`);
}

function readPorts(raw: unknown, path: string): Record<string, PortDecl> {
  const out: Record<string, PortDecl> = {};
  for (const [name, def] of Object.entries(optRecord(raw, path) ?? {})) {
    const d = reqRecord(def, at(path, name));
    out[name] = {
      type: reqString(d["type"], at(at(path, name), "type")),
      // `phase` is optional in practice; the examples always write it.
      phase: optString(d["phase"], at(at(path, name), "phase")) ?? "data",
    };
  }
  return out;
}

function readObjects(o: Record<string, unknown>, path: string): ObjectsSection {
  const out: { -readonly [K in keyof ObjectsSection]: ObjectsSection[K] } = {};
  const map = optRecord(o["map"], at(path, "map"));
  if (map) out.map = stringMap(map, at(path, "map"));
  if (o["consume"] !== undefined) out.consume = stringList(o["consume"], at(path, "consume"));
  if (o["create"] !== undefined) out.create = stringList(o["create"], at(path, "create"));
  if (o["transform"] !== undefined) out.transform = o["transform"];
  return out;
}

function readNode(raw: unknown, path: string): NodeInvocation {
  const n = reqRecord(raw, path);
  return {
    id: reqString(n["id"], at(path, "id")),
    process: reqString(n["process"], at(path, "process")),
    state: readBindings(n["state"], at(path, "state")),
    data: readBindings(n["data"], at(path, "data")),
  };
}

/** `port: { from: "<source>" }`, used by node bindings and composite returns. */
function readBindings(raw: unknown, path: string): Record<string, Binding> {
  const out: Record<string, Binding> = {};
  for (const [port, b] of Object.entries(optRecord(raw, path) ?? {})) {
    if (!isRecord(b)) throw new ReadError(at(path, port), "expected a mapping with `from`");
    out[port] = { from: reqString(b["from"], at(at(path, port), "from")) };
  }
  return out;
}
