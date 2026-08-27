/** Time axis: a linear scale and tick steps that read well in lab units. */

export interface Scale {
  readonly x: (t: number) => number;
  readonly ticks: readonly number[];
  readonly width: number;
  readonly max: number;
}

/**
 * Steps chosen for durations rather than for round decimals: a plan measured
 * in seconds wants 15s / 30s / 1min / 5min gridlines, not 100s.
 */
const STEPS = [
  1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400,
];

export function niceStep(span: number, target = 9): number {
  const raw = span / Math.max(1, target);
  for (const s of STEPS) if (s >= raw) return s;
  return Math.ceil(raw / 86400) * 86400;
}

export function makeScale(max: number, width: number, pad = 10): Scale {
  const span = Math.max(1, max);
  const inner = Math.max(1, width - pad * 2);
  const step = niceStep(span);
  const ticks: number[] = [];
  for (let t = 0; t <= span + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return {
    x: (t) => pad + (t / span) * inner,
    ticks,
    width,
    max: span,
  };
}

/** `second` → `s`, and so on; falls back to the unit as written. */
export function unitAbbrev(unit: string): string {
  return { second: "s", seconds: "s", minute: "min", minutes: "min", hour: "h", hours: "h" }[unit] ?? unit;
}

/** A duration in the document's own unit, e.g. `120 s`. */
export function formatDuration(t: number, unit: string): string {
  return `${t} ${unitAbbrev(unit)}`.trim();
}
