/**
 * Read an execution environment definition — SPECIFICATIONS.md §5.
 *
 * The one piece of real work here is mode ids: §5.5 makes `id` optional and
 * says an omitted one "is assigned automatically (e.g. by position)". The plan
 * records the *assigned* id, so a reader that dropped it could not join a
 * planned activity back to the mode it ran on. `ofp-schedule` numbers from
 * zero as a string, which is what the plans in `examples/outputs` carry.
 */

import { parse as parseYaml } from "yaml";

import type { Device, Environment, Mode, Transport } from "../model/environment";
import {
  at,
  numberMap,
  optList,
  optRecord,
  ReadError,
  reqIdLike,
  reqList,
  reqNumber,
  reqRecord,
  reqString,
  stringList,
  stringMap,
} from "./coerce";

export function readEnvironmentText(text: string): Environment {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ReadError("", `not valid YAML — ${(e as Error).message}`);
  }
  return readEnvironment(raw);
}

export function readEnvironment(raw: unknown): Environment {
  const doc = reqRecord(raw, "");

  const devices = reqList(doc["devices"], "devices").map((d, i) =>
    readDevice(d, at("devices", i)),
  );

  const transporters = (optList(doc["transporters"], "transporters") ?? []).map((t, i) => ({
    id: reqString(reqRecord(t, at("transporters", i))["id"], at(at("transporters", i), "id")),
  }));

  const transports = (optList(doc["transports"], "transports") ?? []).map((t, i) =>
    readTransport(t, at("transports", i)),
  );

  const processes: Record<string, { modes: Mode[] }> = {};
  for (const [name, def] of Object.entries(optRecord(doc["processes"], "processes") ?? {})) {
    const p = reqRecord(def, at("processes", name));
    const modes = reqList(p["modes"], at(at("processes", name), "modes")).map((m, i) =>
      readMode(m, at(at(at("processes", name), "modes"), i), i),
    );
    processes[name] = { modes };
  }

  const out: { -readonly [K in keyof Environment]: Environment[K] } = {
    devices,
    transporters,
    transports,
    processes,
  };

  const time = optRecord(doc["time"], "time");
  if (time) out.time = { unit: reqString(time["unit"], "time.unit") };

  const replenishers = optList(doc["replenishers"], "replenishers");
  if (replenishers)
    out.replenishers = replenishers.map((r, i) => ({
      id: reqString(reqRecord(r, at("replenishers", i))["id"], at(at("replenishers", i), "id")),
    }));

  const replenishments = optList(doc["replenishments"], "replenishments");
  if (replenishments) out.replenishments = replenishments;

  return out;
}

function readDevice(raw: unknown, path: string): Device {
  const d = reqRecord(raw, path);
  const out: { -readonly [K in keyof Device]: Device[K] } = {
    id: reqString(d["id"], at(path, "id")),
    // §5.2: `spots` may be omitted, which means the same as an empty list.
    spots: d["spots"] === undefined || d["spots"] === null ? [] : stringList(d["spots"], at(path, "spots")),
  };
  const resources = optRecord(d["resources"], at(path, "resources"));
  if (resources) {
    const r: Record<string, { capacity: number }> = {};
    for (const [name, def] of Object.entries(resources)) {
      const rp = at(at(path, "resources"), name);
      r[name] = { capacity: reqNumber(reqRecord(def, rp)["capacity"], at(rp, "capacity")) };
    }
    out.resources = r;
  }
  return out;
}

function readTransport(raw: unknown, path: string): Transport {
  const t = reqRecord(raw, path);
  return {
    transporter: reqString(t["transporter"], at(path, "transporter")),
    from: reqString(t["from"], at(path, "from")),
    to: reqString(t["to"], at(path, "to")),
    duration: reqNumber(t["duration"], at(path, "duration")),
  };
}

function readMode(raw: unknown, path: string, index: number): Mode {
  const m = reqRecord(raw, path);
  const out: { -readonly [K in keyof Mode]: Mode[K] } = {
    // §5.5: an omitted id is assigned by position; that is the id the plan writes.
    id: m["id"] === undefined || m["id"] === null ? String(index) : reqIdLike(m["id"], at(path, "id")),
    devices:
      m["devices"] === undefined || m["devices"] === null
        ? []
        : stringList(m["devices"], at(path, "devices")),
    duration: reqNumber(m["duration"], at(path, "duration")),
    inputSpots: stringMap(optRecord(m["input_spots"], at(path, "input_spots")) ?? {}, at(path, "input_spots")),
    outputSpots: stringMap(optRecord(m["output_spots"], at(path, "output_spots")) ?? {}, at(path, "output_spots")),
  };
  const consumption = optRecord(m["consumption"], at(path, "consumption"));
  if (consumption) out.consumption = numberMap(consumption, at(path, "consumption"));

  // §5.5: a mode that occupies a device must have a positive duration; a
  // device-less Pure-Data-only mode may be instantaneous.
  if (out.devices.length > 0 && out.duration <= 0)
    throw new ReadError(at(path, "duration"), `a mode holding a device needs a positive duration, got ${out.duration}`);
  if (out.duration < 0)
    throw new ReadError(at(path, "duration"), `a duration is never negative, got ${out.duration}`);

  return out;
}
