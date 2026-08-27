/**
 * Read an execution document — SPECIFICATIONS.md §6.
 *
 * Plan and status share one schema (§6.2), so this one reader serves both.
 * Unknown keys are kept out of the model but never rejected: `x-` extension
 * keys are legal (§9.4) and a newer scheduler may add fields this viewer has
 * not learned yet.
 *
 * The spec's exceptions are the parts worth reading twice — they are what a
 * naive reader gets wrong:
 *   - `transporter` is absent on a same-spot move (§6.4).
 *   - Every leg of a multi-hop move carries the *same* logical `arc`; the legs
 *     differ by `seq` and by their physical spots (§6.4).
 *   - A stay-put relay is folded out of the output; its absence is normal (§6.4.1).
 *   - A boundary arc endpoint has an *empty* node path — not a missing one (§6.4).
 *   - `objective.kind` / `value` are a scalar or a list (§6.1).
 *   - A Pure-Data-only processing activity has no devices and no spots (§6.3).
 */

import { parse as parseYaml } from "yaml";

import type { ArcRef, NodePath, PortRef } from "../model/common";
import type {
  Activity,
  ActivityStatus,
  ExecutionDocument,
  InterfaceBinding,
  Inventories,
  Objective,
  Outcome,
  ProcessingActivity,
  RelayActivity,
  ReplenishmentActivity,
  TransportActivity,
} from "../model/document";
import {
  at,
  numberMap,
  oneOf,
  optList,
  optNumber,
  optRecord,
  optString,
  ReadError,
  reqIdLike,
  reqList,
  reqNumber,
  reqRecord,
  reqString,
  stringList,
  stringMap,
} from "./coerce";

const OUTCOMES = ["optimal", "feasible", "infeasible", "unknown"] as const;
const STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;
const KINDS = ["processing", "transport", "relay", "replenishment"] as const;

/** Parse YAML text into an execution document. */
export function readExecutionDocumentText(text: string): ExecutionDocument {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ReadError("", `not valid YAML — ${(e as Error).message}`);
  }
  return readExecutionDocument(raw);
}

/** Read an already-parsed document (a plan or a status). */
export function readExecutionDocument(raw: unknown): ExecutionDocument {
  const doc = reqRecord(raw, "");

  const time = optRecord(doc["time"], "time");
  const iface = optRecord(doc["interface"], "interface");
  const inv = optRecord(doc["inventories"], "inventories");
  const obj = optRecord(doc["objective"], "objective");
  const meta = optRecord(doc["meta"], "meta");

  const activities = reqList(doc["activities"], "activities").map((a, i) =>
    readActivity(a, at("activities", i)),
  );

  const out: {
    -readonly [K in keyof ExecutionDocument]: ExecutionDocument[K];
  } = { activities };

  if (time) out.time = { unit: reqString(time["unit"], "time.unit") };
  const now = optNumber(doc["now"], "now");
  if (now !== undefined) out.now = now;
  if (iface) out.interface = readInterface(iface);
  if (inv) out.inventories = readInventories(inv);
  if (doc["outcome"] !== undefined && doc["outcome"] !== null)
    out.outcome = oneOf<Outcome>(doc["outcome"], "outcome", OUTCOMES);
  if (obj) out.objective = readObjective(obj);
  if (meta) {
    const wf = optString(meta["workflow"], "meta.workflow");
    const env = optString(meta["environment"], "meta.environment");
    const m: { workflow?: string; environment?: string } = {};
    if (wf !== undefined) m.workflow = wf;
    if (env !== undefined) m.environment = env;
    out.meta = m;
  }
  return out;
}

function readObjective(o: Record<string, unknown>): Objective {
  const rawKind = o["kind"];
  const kind = Array.isArray(rawKind)
    ? stringList(rawKind, "objective.kind")
    : reqString(rawKind, "objective.kind");

  const rawValue = o["value"];
  if (rawValue === undefined || rawValue === null) return { kind };
  const value = Array.isArray(rawValue)
    ? reqList(rawValue, "objective.value").map((v, i) => reqNumber(v, at("objective.value", i)))
    : reqNumber(rawValue, "objective.value");

  if (Array.isArray(kind) !== Array.isArray(value))
    throw new ReadError(
      "objective",
      "`kind` and `value` must have the same shape — both scalar or both lists (§6.1)",
    );
  return { kind, value };
}

function readInterface(i: Record<string, unknown>): InterfaceBinding {
  const inputs = i["inputs"] === undefined ? {} : stringMap(i["inputs"], "interface.inputs");
  const outputs = optRecord(i["outputs"], "interface.outputs");
  return outputs ? { inputs, outputs: stringMap(outputs, "interface.outputs") } : { inputs };
}

function readInventories(i: Record<string, unknown>): Inventories {
  const src = reqRecord(i["levels"], "inventories.levels");
  const levels: Record<string, Record<string, number>> = {};
  for (const [dev, byRes] of Object.entries(src))
    levels[dev] = numberMap(byRes, at("inventories.levels", dev));
  return { levels };
}

function readActivity(raw: unknown, path: string): Activity {
  const a = reqRecord(raw, path);
  const kind = oneOf(a["kind"], at(path, "kind"), KINDS);

  const status: ActivityStatus =
    a["status"] === undefined || a["status"] === null
      ? "pending"
      : oneOf<ActivityStatus>(a["status"], at(path, "status"), STATUSES);
  const start = reqNumber(a["start"], at(path, "start"));
  const end = reqNumber(a["end"], at(path, "end"));
  if (end < start)
    throw new ReadError(path, `end (${end}) is before start (${start})`);

  const base = { status, start, end } as const;

  switch (kind) {
    case "processing":
      return readProcessing(a, path, base);
    case "transport":
      return readTransport(a, path, base);
    case "relay":
      return readRelay(a, path, base);
    case "replenishment":
      return readReplenishment(a, path, base);
  }
}

type Base = { readonly status: ActivityStatus; readonly start: number; readonly end: number };

function readProcessing(
  a: Record<string, unknown>,
  path: string,
  base: Base,
): ProcessingActivity {
  const node = readNodePath(a["node"], at(path, "node"));
  if (node.length === 0)
    throw new ReadError(at(path, "node"), "a processing activity always has a non-empty node path (§6.3)");

  const out: { -readonly [K in keyof ProcessingActivity]: ProcessingActivity[K] } = {
    ...base,
    kind: "processing",
    process: reqString(a["process"], at(path, "process")),
    mode: reqIdLike(a["mode"], at(path, "mode")),
    node,
  };
  // All four are a derivable echo (§6.3) and are absent on a Pure-Data-only step.
  const devices = optList(a["devices"], at(path, "devices"));
  if (devices) out.devices = devices.map((d, i) => reqString(d, at(at(path, "devices"), i)));
  const inS = optRecord(a["input_spots"], at(path, "input_spots"));
  if (inS) out.inputSpots = stringMap(inS, at(path, "input_spots"));
  const outS = optRecord(a["output_spots"], at(path, "output_spots"));
  if (outS) out.outputSpots = stringMap(outS, at(path, "output_spots"));
  const cons = optRecord(a["consumption"], at(path, "consumption"));
  if (cons) out.consumption = numberMap(cons, at(path, "consumption"));
  return out;
}

function readTransport(
  a: Record<string, unknown>,
  path: string,
  base: Base,
): TransportActivity {
  const fromSpot = reqString(a["from_spot"], at(path, "from_spot"));
  const toSpot = reqString(a["to_spot"], at(path, "to_spot"));
  const transporter = optString(a["transporter"], at(path, "transporter"));

  // §6.4: `transporter` is required except on a same-spot move, which no
  // transporter performs. Anything else missing it is a malformed document.
  if (transporter === undefined && fromSpot !== toSpot)
    throw new ReadError(
      path,
      `a transport between different spots needs a transporter (${fromSpot} -> ${toSpot}, §6.4)`,
    );

  const out: { -readonly [K in keyof TransportActivity]: TransportActivity[K] } = {
    ...base,
    kind: "transport",
    fromSpot,
    toSpot,
    arc: readArc(a["arc"], at(path, "arc")),
  };
  if (transporter !== undefined) out.transporter = transporter;
  const seq = optNumber(a["seq"], at(path, "seq"));
  if (seq !== undefined) out.seq = seq;
  return out;
}

function readRelay(a: Record<string, unknown>, path: string, base: Base): RelayActivity {
  if (base.end !== base.start)
    throw new ReadError(path, `a relay is instantaneous, but end (${base.end}) != start (${base.start}) (§6.4.1)`);
  return {
    ...base,
    kind: "relay",
    arc: readArc(a["arc"], at(path, "arc")),
    seq: reqNumber(a["seq"], at(path, "seq")),
    spot: reqString(a["spot"], at(path, "spot")),
  };
}

function readReplenishment(
  a: Record<string, unknown>,
  path: string,
  base: Base,
): ReplenishmentActivity {
  const amounts = numberMap(reqRecord(a["amounts"], at(path, "amounts")), at(path, "amounts"));
  if (Object.keys(amounts).length === 0)
    throw new ReadError(at(path, "amounts"), "a replenishment must add something (§6.9)");
  return {
    ...base,
    kind: "replenishment",
    id: reqString(a["id"], at(path, "id")),
    device: reqString(a["device"], at(path, "device")),
    replenisher: reqString(a["replenisher"], at(path, "replenisher")),
    amounts,
  };
}

/** A node path is a list of ids; the empty list is the workflow interface. */
function readNodePath(raw: unknown, path: string): NodePath {
  if (raw === undefined || raw === null) return [];
  return stringList(raw, path);
}

function readPortRef(raw: unknown, path: string): PortRef {
  const e = reqRecord(raw, path);
  return { node: readNodePath(e["node"], at(path, "node")), port: reqString(e["port"], at(path, "port")) };
}

function readArc(raw: unknown, path: string): ArcRef {
  const a = reqRecord(raw, path);
  return { from: readPortRef(a["from"], at(path, "from")), to: readPortRef(a["to"], at(path, "to")) };
}
