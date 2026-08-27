/**
 * Small coercion helpers with a location trail.
 *
 * The viewer is not a validator — `ofplang-validate` and `ofp-schedule
 * validate` own that. These helpers exist so that a malformed document
 * produces one legible message naming the field, instead of `undefined is not
 * an object` somewhere in the renderer.
 */

export class ReadError extends Error {
  constructor(
    readonly at: string,
    message: string,
  ) {
    super(`${at || "<root>"}: ${message}`);
    this.name = "ReadError";
  }
}

const kindOf = (v: unknown): string => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "a mapping";
  return `${typeof v} (${JSON.stringify(v)})`;
};

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const at = (base: string, key: string | number): string =>
  typeof key === "number" ? `${base}[${key}]` : base ? `${base}.${key}` : key;

export function reqRecord(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) throw new ReadError(path, `expected a mapping, got ${kindOf(v)}`);
  return v;
}

export function reqList(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ReadError(path, `expected a list, got ${kindOf(v)}`);
  return v;
}

export function reqString(v: unknown, path: string): string {
  if (typeof v !== "string") throw new ReadError(path, `expected a string, got ${kindOf(v)}`);
  return v;
}

/** Mode ids are `'0'` in YAML but a bare `0` would also be readable. */
export function reqIdLike(v: unknown, path: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new ReadError(path, `expected an identifier, got ${kindOf(v)}`);
}

export function reqNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new ReadError(path, `expected a number, got ${kindOf(v)}`);
  return v;
}

export function optNumber(v: unknown, path: string): number | undefined {
  return v === undefined || v === null ? undefined : reqNumber(v, path);
}

export function optString(v: unknown, path: string): string | undefined {
  return v === undefined || v === null ? undefined : reqString(v, path);
}

export function optRecord(v: unknown, path: string): Record<string, unknown> | undefined {
  return v === undefined || v === null ? undefined : reqRecord(v, path);
}

export function optList(v: unknown, path: string): unknown[] | undefined {
  return v === undefined || v === null ? undefined : reqList(v, path);
}

export function stringList(v: unknown, path: string): string[] {
  return reqList(v, path).map((x, i) => reqString(x, at(path, i)));
}

export function stringMap(v: unknown, path: string): Record<string, string> {
  const src = reqRecord(v, path);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(src)) out[k] = reqString(val, at(path, k));
  return out;
}

export function numberMap(v: unknown, path: string): Record<string, number> {
  const src = reqRecord(v, path);
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(src)) out[k] = reqNumber(val, at(path, k));
  return out;
}

export function oneOf<T extends string>(
  v: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const s = reqString(v, path);
  if (!(allowed as readonly string[]).includes(s))
    throw new ReadError(path, `expected one of ${allowed.join(" / ")}, got "${s}"`);
  return s as T;
}
