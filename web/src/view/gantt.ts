/**
 * Draw a Gantt layout as SVG.
 *
 * Three elements share one geometry: a sticky label gutter, a time axis that
 * scrolls with the plot, and the plot itself. Colours live in the stylesheet,
 * so the same markup serves both themes; only the export path (`view/export`)
 * needs them resolved.
 */

import { ganttLayout, type GanttView } from "../layout/gantt";
import { makeScale, unitAbbrev, type Scale } from "../layout/scale";
import type { Scene } from "../model/scene";

export const LANE_H = 27;
const LANE_H_MAX = 44;
const BAR_H = 13;
const HELD_H = 4;
const AXIS_H = 27;
export const GUTTER_W = 176;

export interface GanttGeometry {
  readonly gutter: string;
  readonly axis: string;
  readonly plot: string;
  readonly width: number;
  readonly height: number;
  readonly scale: Scale;
}

export interface GanttOptions {
  readonly view: GanttView;
  /** Plot width in px before zoom. */
  readonly baseWidth: number;
  readonly zoom: number;
  /** Activity indices to emphasise; everything else dims. Empty = no selection. */
  readonly lit: ReadonlySet<number>;
  readonly showLabels: boolean;
  /** Height of the box the chart sits in; short charts grow to fill it. */
  readonly availableHeight?: number;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** IBM Plex Mono at 9.5px runs about 5.7px to the character. */
const CH = 5.7;

/** The label, trimmed to the room available — or nothing, if there is none. */
function fit(label: string, room: number): string {
  if (room < CH * 3) return "";
  const max = Math.floor(room / CH);
  return label.length <= max ? label : clip(label, max);
}

export function renderGantt(scene: Scene, opts: GanttOptions): GanttGeometry {
  const { lanes, bars } = ganttLayout(scene, opts.view);
  // A four-lane plan stranded at the top of a tall pane looks unfinished. Give
  // the lanes the spare room, up to a point — past that the rows stop reading
  // as one chart.
  const laneH =
    opts.availableHeight && lanes.length
      ? Math.max(LANE_H, Math.min(LANE_H_MAX, Math.floor((opts.availableHeight - 6) / lanes.length)))
      : LANE_H;
  const height = Math.max(lanes.length * laneH + 4, 48);
  const width = Math.max(240, opts.baseWidth * opts.zoom);
  const scale = makeScale(Math.max(scene.metrics.makespan, scene.metrics.horizon), width);
  const active = opts.lit.size > 0;

  const gutter: string[] = [];
  const plot: string[] = [];

  lanes.forEach((lane, i) => {
    const y = i * laneH;
    if (i % 2) {
      gutter.push(`<rect class="lane-alt" x="0" y="${y}" width="${GUTTER_W}" height="${laneH}"/>`);
      plot.push(`<rect class="lane-alt" x="0" y="${y}" width="${width}" height="${laneH}"/>`);
    }
    gutter.push(
      `<text class="lane-label" x="10" y="${y + laneH / 2 + 3.5}">${esc(clip(lane.label, 21))}</text>`,
    );
    if (lane.tag)
      gutter.push(
        `<text class="lane-tag" x="${GUTTER_W - 8}" y="${y + laneH / 2 + 3}" text-anchor="end">${esc(lane.tag)}</text>`,
      );
    gutter.push(`<line class="lane-rule" x1="0" y1="${y + laneH}" x2="${GUTTER_W}" y2="${y + laneH}"/>`);
    plot.push(`<line class="lane-rule" x1="0" y1="${y + laneH}" x2="${width}" y2="${y + laneH}"/>`);
  });

  for (const t of scale.ticks)
    plot.push(`<line class="grid-ln" x1="${scale.x(t)}" y1="0" x2="${scale.x(t)}" y2="${height}"/>`);

  // Labels are placed against their neighbours, not just against the plot
  // edge: a bar's caption sits in the gap before whatever comes next on the
  // same lane, and is dropped when that gap is too small. Without this a busy
  // lane — a single transporter running 22 moves — renders as overlapping
  // fragments of a dozen words.
  const occupied = new Map<number, number[]>();
  for (const bar of bars) {
    const list = occupied.get(bar.lane);
    if (list) list.push(scale.x(bar.start));
    else occupied.set(bar.lane, [scale.x(bar.start)]);
  }
  for (const list of occupied.values()) list.sort((a, b) => a - b);
  const nextStartOn = (lane: number, after: number): number => {
    for (const x of occupied.get(lane) ?? []) if (x > after + 0.5) return x;
    return width;
  };

  for (const bar of bars) {
    const a = scene.activities[bar.index]!;
    const y = bar.lane * laneH + (laneH - BAR_H) / 2;
    const on = !active || opts.lit.has(bar.index);
    const cls = [
      "bar",
      bar.style,
      a.status === "completed" ? "done" : "",
      active && opts.lit.has(bar.index) ? "lit" : "",
      active && !on ? "dim" : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (bar.style === "relay") {
      // A relay is instantaneous (§6.4.1) — a point, drawn as a small diamond.
      const cx = scale.x(bar.start);
      const cy = y + BAR_H / 2;
      plot.push(
        `<rect class="${cls}" data-i="${bar.index}" x="${cx - 4}" y="${cy - 4}" width="8" height="8" transform="rotate(45 ${cx} ${cy})"/>`,
      );
      continue;
    }

    const x0 = scale.x(bar.start);
    const x1 = scale.x(bar.end);
    const held = bar.style === "held";
    const w = Math.max(2.5, x1 - x0 - 2);
    // A held device is secondary information — the machine is blocked, but
    // nothing is happening on it. A band under the row says that without
    // competing with the work itself.
    const h = held ? HELD_H : BAR_H;
    plot.push(
      `<rect class="${cls}" data-i="${bar.index}" x="${x0 + 1}" y="${held ? y + BAR_H - HELD_H : y}" width="${w}" height="${h}"/>`,
    );

    if (!opts.showLabels || !bar.label || held) continue;
    const baseline = y + BAR_H - 3.5;
    const inside = fit(bar.label, w - 9);
    if (inside)
      plot.push(`<text class="bar-tx" x="${x0 + 5}" y="${baseline}">${esc(inside)}</text>`);
    else {
      const gap = nextStartOn(bar.lane, x0) - x1 - 9;
      const outside = fit(bar.label, gap);
      if (outside)
        plot.push(`<text class="bar-tx outside" x="${x1 + 5}" y="${baseline}">${esc(outside)}</text>`);
    }
  }

  const axis: string[] = [
    `<text class="axis-cap" x="6" y="11">TIME (${esc(unitAbbrev(scene.unit).toUpperCase())})</text>`,
  ];
  for (const t of scale.ticks)
    axis.push(`<text class="tick-tx" x="${scale.x(t)}" y="23" text-anchor="middle">${t}</text>`);

  if (typeof scene.doc.now === "number") {
    const nx = scale.x(scene.doc.now);
    plot.push(`<line class="nowline" x1="${nx}" y1="0" x2="${nx}" y2="${height}"/>`);
    axis.push(`<text class="nowcap" x="${nx}" y="11" text-anchor="middle">now</text>`);
  }

  return {
    gutter: gutter.join(""),
    axis: axis.join(""),
    plot: plot.join(""),
    width,
    height,
    scale,
  };
}

export const AXIS_HEIGHT = AXIS_H;
