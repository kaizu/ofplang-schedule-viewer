/**
 * Pointer and pane behaviour that is about the shell rather than the data:
 * opening a composite, dragging the divider, putting a plan in the clipboard.
 *
 * Kept out of `app.ts` so that file stays about state and rendering.
 */

import { findNode, type GraphNode } from "./model/graph";
import { encodeShare, ShareTooLarge, type SharePayload } from "./share";

export const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function placeTip(tip: HTMLElement, e: MouseEvent): void {
  tip.style.display = "block";
  const box = tip.getBoundingClientRect();
  const x = e.clientX + 14 + box.width > innerWidth - 8 ? e.clientX - box.width - 12 : e.clientX + 14;
  const y = e.clientY + 14 + box.height > innerHeight - 8 ? e.clientY - box.height - 12 : e.clientY + 14;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

/** One drawn connection: a port of one visible box to a port of another. */
export interface EdgeRef {
  readonly fromKey: string;
  readonly fromPort: string;
  readonly toKey: string;
  readonly toPort: string;
  readonly object: boolean;
  /** Declared types at either end, when the workflow says. */
  readonly fromType?: string;
  readonly toType?: string;
}

export interface GraphHandlers {
  readonly graph: () => GraphNode | undefined;
  readonly expanded: () => ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (key: string | undefined) => void;
  readonly onSelectEdge: (edge: EdgeRef) => void;
}

/**
 * The edge under the pointer.
 *
 * Hit lines are wide, so where two arcs leave one port — `Az.a_score` feeds
 * both a step and the workflow's output — their hit lines overlap, and the one
 * drawn last would take every click near the shared end. So every hit line
 * under the pointer is a candidate, and the one whose drawn curve passes
 * nearest wins.
 */
const edgeUnder = (e: MouseEvent): EdgeRef | undefined => {
  const hits = document
    .elementsFromPoint(e.clientX, e.clientY)
    .filter((el): el is SVGPathElement => el instanceof SVGPathElement && el.classList.contains("edge-hit"));
  if (!hits.length) return undefined;
  const best = hits.length === 1 ? hits[0]! : nearest(hits, e);
  return edgeOf(best);
};

function nearest(paths: readonly SVGPathElement[], e: MouseEvent): SVGPathElement {
  let best = paths[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of paths) {
    const ctm = p.getScreenCTM();
    if (!ctm) continue;
    const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const length = p.getTotalLength();
    // Every few pixels along the curve is close enough for a 10px-wide target.
    for (let s = 0; s <= length; s += 3) {
      const q = p.getPointAtLength(s);
      const d = (q.x - at.x) ** 2 + (q.y - at.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

const edgeOf = (hit: SVGPathElement): EdgeRef => {
  const d = hit.dataset;
  return {
    fromKey: d["from"] ?? "",
    fromPort: d["fromPort"] ?? "",
    toKey: d["to"] ?? "",
    toPort: d["toPort"] ?? "",
    object: d["object"] === "true",
    ...(d["fromType"] !== undefined ? { fromType: d["fromType"] } : {}),
    ...(d["toType"] !== undefined ? { toType: d["toType"] } : {}),
  };
};

/**
 * What an edge carries, in words: its declared type and whether that is an
 * Object or Pure Data. The two ends normally agree; where they do not (a
 * generic, a document that does not validate) both are shown.
 */
export const carriesLabel = (e: EdgeRef): string => {
  const kind = e.object ? "an Object" : "Pure Data";
  const { fromType, toType } = e;
  if (fromType === undefined && toType === undefined) return kind;
  if (fromType === undefined || toType === undefined || fromType === toType)
    return `${fromType ?? toType} (${kind})`;
  return `${fromType} → ${toType} (${kind})`;
};

export const edgeLabel = (e: EdgeRef): string =>
  `${e.fromKey ? `${e.fromKey}.` : "inputs."}${e.fromPort} → ${e.toKey ? `${e.toKey}.` : "outputs."}${e.toPort}`;

export function wireGraphPointer(handlers: GraphHandlers): void {
  const host = el("graph");
  const tip = el("tip");

  const keyAt = (target: EventTarget | null): string | undefined =>
    (target as Element | null)?.closest<SVGGElement>("[data-key]")?.dataset["key"];

  host.addEventListener("click", (e) => {
    const edge = edgeUnder(e);
    if (edge) {
      handlers.onSelectEdge(edge);
      return;
    }
    const key = keyAt(e.target);
    if (key === undefined) {
      handlers.onSelect(undefined);
      return;
    }
    // The badge and the close caption open and shut the box; the rest of it
    // selects (design.md D11).
    const cls = (e.target as Element).classList;
    const isHandle = cls.contains("badge") || cls.contains("btext") || cls.contains("chev");
    if (isHandle && key !== "") handlers.onToggle(key);
    else handlers.onSelect(key);
  });

  host.addEventListener("dblclick", (e) => {
    const key = keyAt(e.target);
    if (key) handlers.onToggle(key);
  });

  host.addEventListener("mousemove", (e) => {
    const edge = edgeUnder(e);
    if (edge) {
      tip.innerHTML =
        `<div class="tt">${escapeHtml(edgeLabel(edge))}</div>` +
        `<div class="tl">carries ${escapeHtml(carriesLabel(edge))} · click to trace it</div>`;
      placeTip(tip, e);
      return;
    }
    const graph = handlers.graph();
    const key = keyAt(e.target);
    const node = graph && key !== undefined ? findNode(graph, key) : undefined;
    if (!node) {
      tip.style.display = "none";
      return;
    }
    const open = node.key === "" || handlers.expanded().has(node.key);
    const detail =
      node.kind === "composite"
        ? `${node.atomicCount} atomic steps · ${open ? "open" : "double-click to open"}`
        : `process ${node.process}`;
    tip.innerHTML = `<div class="tt">${escapeHtml(node.key || node.process)}</div><div class="tl">${escapeHtml(detail)}</div>`;
    placeTip(tip, e);
  });

  host.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

export function wireSplitter(get: () => number, set: (pct: number) => void, after: () => void): void {
  const splitter = el("splitter");
  const stack = el("stack");
  const apply = (): void => {
    stack.style.setProperty("--r1", `${get()}fr`);
    stack.style.setProperty("--r2", `${100 - get()}fr`);
  };
  const clamp = (pct: number): number => Math.max(12, Math.min(84, pct));
  let dragging = false;

  splitter.addEventListener("pointerdown", (e) => {
    dragging = true;
    splitter.setPointerCapture(e.pointerId);
  });
  splitter.addEventListener("pointerup", (e) => {
    dragging = false;
    splitter.releasePointerCapture(e.pointerId);
    after();
  });
  splitter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const box = stack.getBoundingClientRect();
    set(clamp(((e.clientY - box.top) / box.height) * 100));
    apply();
  });
  splitter.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowUp" ? -4 : e.key === "ArrowDown" ? 4 : 0;
    if (!step) return;
    e.preventDefault();
    set(clamp(get() + step));
    apply();
    after();
  });

  apply();
}

export async function copyShareLink(
  payload: SharePayload,
  ok: (message: string) => void,
  fail: (headline: string, detail: string) => void,
): Promise<void> {
  try {
    const fragment = await encodeShare(payload);
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#d=${fragment}`);
    ok(`Link copied — ${fragment.length.toLocaleString()} characters.`);
  } catch (e) {
    if (e instanceof ShareTooLarge) fail("That plan will not fit in a link.", e.message);
    else fail("Could not copy the link.", String(e));
  }
}
