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

export interface GraphHandlers {
  readonly graph: () => GraphNode | undefined;
  readonly expanded: () => ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (key: string | undefined) => void;
}

export function wireGraphPointer(handlers: GraphHandlers): void {
  const host = el("graph");
  const tip = el("tip");

  const keyAt = (target: EventTarget | null): string | undefined =>
    (target as Element | null)?.closest<SVGGElement>("[data-key]")?.dataset["key"];

  host.addEventListener("click", (e) => {
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
