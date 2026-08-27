/**
 * The application: load a plan, draw it, let someone read it.
 *
 * Four ways in (design.md D9): a bundled dataset named by `?doc=`, files
 * dropped on the window, and — from P2 — a share link and an external URL.
 * Everything else here is state: which dataset, which view, what is selected.
 */

import { parse as parseYaml } from "yaml";

import { GANTT_VIEWS, type GanttView } from "./layout/gantt";
import { buildScene, sameArc, type Scene } from "./model/scene";
import {
  gateSummary,
  gateWorkflow,
  readEnvironment,
  readEnvironmentText,
  readExecutionDocument,
  readExecutionDocumentText,
  readWorkflow,
  readWorkflowText,
  ReadError,
  type GateReport,
} from "./read";
import { downloadSvg, ganttToSvg } from "./view/export";
import { GUTTER_W, renderGantt, type GanttGeometry } from "./view/gantt";
import { renderInspector, statusLine, tooltipFor } from "./view/inspector";
import { formatDuration } from "./layout/scale";

interface DatasetIndexEntry {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly origin: string;
  readonly activities: number;
}

interface DatasetPayload {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly source: { plan: string; workflow: string | null; environment: string | null };
  readonly plan: unknown;
  readonly workflow: unknown;
  readonly environment: unknown;
}

interface State {
  index: DatasetIndexEntry[];
  scene?: Scene;
  blurb: string;
  source: string;
  gate?: GateReport;
  view: GanttView;
  zoom: number;
  labels: boolean;
  selected?: number;
  geometry?: GanttGeometry;
}

const state: State = { index: [], blurb: "", source: "", view: "device", zoom: 1, labels: true };

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

/* ── boot ──────────────────────────────────────────────────────────────── */

export async function start(): Promise<void> {
  buildViewButtons();
  wireControls();
  wireDropTarget();
  wirePointer();

  try {
    const res = await fetch(new URL("datasets/index.json", document.baseURI));
    state.index = res.ok ? ((await res.json()) as DatasetIndexEntry[]) : [];
  } catch {
    state.index = [];
  }

  const picker = el<HTMLSelectElement>("dataset");
  picker.innerHTML = state.index
    .map((d) => `<option value="${d.id}">${escapeHtml(d.label)} · ${d.activities}</option>`)
    .join("");

  const wanted = new URLSearchParams(location.search).get("doc");
  const first = state.index.find((d) => d.id === wanted) ?? state.index[state.index.length - 1];
  if (first) {
    picker.value = first.id;
    await loadDataset(first.id);
  } else {
    showBanner(
      "No bundled plans were found.",
      ["Run <code>npm run datasets</code>, or drop a plan YAML onto this window."],
    );
  }
}

async function loadDataset(id: string): Promise<void> {
  const res = await fetch(new URL(`datasets/${id}.json`, document.baseURI));
  if (!res.ok) {
    showBanner(`Could not load the plan "${id}".`, [`The server answered ${res.status}.`]);
    return;
  }
  const payload = (await res.json()) as DatasetPayload;

  const url = new URL(location.href);
  url.searchParams.set("doc", id);
  history.replaceState(null, "", url);

  const doc = readExecutionDocument(payload.plan);
  const env = payload.environment ? readEnvironment(payload.environment) : undefined;
  const workflow = payload.workflow ? readWorkflow(payload.workflow) : undefined;

  state.gate = payload.workflow ? gateWorkflow(payload.workflow) : undefined;
  state.blurb = payload.blurb;
  state.source = [payload.source.plan, payload.source.workflow, payload.source.environment]
    .filter(Boolean)
    .join("  ·  ");
  state.selected = undefined;
  state.zoom = 1;
  state.scene = buildScene(doc, env, workflow);
  renderAll();
}

/* ── rendering ─────────────────────────────────────────────────────────── */

function renderAll(): void {
  const scene = state.scene;
  if (!scene) return;

  el("ro-outcome").textContent = scene.doc.outcome ?? "—";
  el("ro-makespan").textContent = formatDuration(scene.metrics.makespan, scene.unit);
  el("ro-count").textContent = String(scene.activities.length);
  el("status-source").textContent = state.source;
  el("status-selection").textContent = statusLine(scene, state.selected);
  el("inspector").innerHTML = renderInspector(scene, state.selected, state.blurb);

  renderBanner();
  renderChart();
}

function renderChart(): void {
  const scene = state.scene;
  if (!scene) return;

  // Measured from the pane, never from the scrolling row: the row is sized by
  // what is inside it, so measuring there feeds each zoom back into the next
  // one. The gutter sits inside that width, so the plot gets what is left.
  const base = Math.max(360, el("chart").clientWidth - GUTTER_W - 18);
  const lit = new Set<number>();
  if (state.selected !== undefined) for (const i of sameArc(scene, state.selected)) lit.add(i);

  const g = renderGantt(scene, {
    view: state.view,
    baseWidth: base,
    zoom: state.zoom,
    lit,
    showLabels: state.labels,
    availableHeight: el("body-row").clientHeight,
  });
  state.geometry = g;

  const gutter = el<SVGSVGElement & HTMLElement>("gutter");
  gutter.setAttribute("width", String(GUTTER_W));
  gutter.setAttribute("height", String(g.height));
  gutter.innerHTML = g.gutter;

  const axis = el<SVGSVGElement & HTMLElement>("axis");
  axis.setAttribute("width", String(g.width));
  axis.setAttribute("height", "27");
  axis.innerHTML = g.axis;

  const plot = el<SVGSVGElement & HTMLElement>("plot");
  plot.setAttribute("width", String(g.width));
  plot.setAttribute("height", String(g.height));
  plot.innerHTML = g.plot;
}

function renderBanner(): void {
  const gate = state.gate;
  if (!gate || gate.supported) {
    hideBanner();
    return;
  }
  showBanner(
    gateSummary(gate),
    gate.findings.map((f) => `${escapeHtml(f.what)} at <code>${escapeHtml(f.at)}</code> — ${escapeHtml(f.why)}`),
  );
}

function showBanner(headline: string, details: readonly string[]): void {
  const banner = el("banner");
  banner.innerHTML =
    `<div><b>${escapeHtml(headline)}</b>` +
    (details.length ? `<ul>${details.map((d) => `<li>${d}</li>`).join("")}</ul>` : "") +
    `</div>`;
  banner.hidden = false;
}

const hideBanner = (): void => {
  el("banner").hidden = true;
};

/* ── controls ──────────────────────────────────────────────────────────── */

function buildViewButtons(): void {
  el("views").innerHTML = GANTT_VIEWS.map(
    (v) =>
      `<button data-view="${v.id}" title="${escapeHtml(v.hint)}" aria-pressed="${v.id === state.view}">${v.label}</button>`,
  ).join("");
}

function wireControls(): void {
  el("views").addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (!button) return;
    state.view = button.dataset["view"] as GanttView;
    for (const b of el("views").querySelectorAll("[data-view]"))
      b.setAttribute("aria-pressed", String(b === button));
    renderChart();
  });

  el<HTMLSelectElement>("dataset").addEventListener("change", (e) => {
    void loadDataset((e.target as HTMLSelectElement).value);
  });

  el<HTMLSelectElement>("theme").addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", value);
  });

  el("labels").addEventListener("click", (e) => {
    state.labels = !state.labels;
    (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(state.labels));
    renderChart();
  });

  el("zoom-in").addEventListener("click", () => {
    state.zoom = Math.min(16, state.zoom * 1.4);
    renderChart();
  });
  el("zoom-out").addEventListener("click", () => {
    state.zoom = Math.max(1, state.zoom / 1.4);
    renderChart();
  });
  el("zoom-fit").addEventListener("click", () => {
    state.zoom = 1;
    renderChart();
  });

  el("export").addEventListener("click", () => {
    const scene = state.scene;
    const g = state.geometry;
    if (!scene || !g) return;
    const name = new URLSearchParams(location.search).get("doc") ?? "plan";
    const svg = ganttToSvg(g, `${name} — ${state.view}`, document.documentElement);
    downloadSvg(svg, `${name}.${state.view}.svg`);
  });

  // The axis follows the one scroll container horizontally.
  el("body-row").addEventListener("scroll", () => {
    el("axis-scroll").scrollLeft = el("body-row").scrollLeft;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") select(undefined);
  });

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 120);
  });
}

function select(index: number | undefined): void {
  state.selected = state.selected === index ? undefined : index;
  renderAll();
}

/* ── pointer ───────────────────────────────────────────────────────────── */

function wirePointer(): void {
  const plot = el("plot");
  const tip = el("tip");

  plot.addEventListener("click", (e) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    select(hit ? Number(hit.dataset["i"]) : undefined);
  });

  plot.addEventListener("mousemove", (e) => {
    const scene = state.scene;
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!scene || !hit) {
      tip.style.display = "none";
      return;
    }
    tip.innerHTML = tooltipFor(scene, Number(hit.dataset["i"]));
    tip.style.display = "block";
    const box = tip.getBoundingClientRect();
    const x = e.clientX + 14 + box.width > innerWidth - 8 ? e.clientX - box.width - 12 : e.clientX + 14;
    const y = e.clientY + 14 + box.height > innerHeight - 8 ? e.clientY - box.height - 12 : e.clientY + 14;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  });

  plot.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

/* ── dropped files ─────────────────────────────────────────────────────── */

/**
 * Files are sorted by what they turn out to be, not by their name: the reader
 * that accepts a file decides. A plan replaces the scene; a workflow or an
 * environment attaches to the plan already loaded, so the three can arrive in
 * any order and in any number of drops.
 */
function wireDropTarget(): void {
  const overlay = el("drop");
  let depth = 0;

  addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth += 1;
    overlay.classList.add("on");
  });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.remove("on");
  });
  addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove("on");
    void acceptFiles([...(e.dataTransfer?.files ?? [])]);
  });
}

async function acceptFiles(files: readonly File[]): Promise<void> {
  if (!files.length) return;

  let doc = state.scene?.doc;
  let env = state.scene?.env;
  let workflow = state.scene?.workflow;
  let gate = state.gate;
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    const text = await file.text();
    try {
      doc = readExecutionDocumentText(text);
      accepted.push(`${file.name} → plan`);
      state.selected = undefined;
      continue;
    } catch {
      /* not a plan; try the next shape */
    }
    try {
      workflow = readWorkflowText(text);
      gate = gateWorkflow(parseYaml(text));
      accepted.push(`${file.name} → workflow`);
      continue;
    } catch {
      /* not a workflow */
    }
    try {
      env = readEnvironmentText(text);
      accepted.push(`${file.name} → environment`);
      continue;
    } catch (e) {
      rejected.push(`${file.name} — ${e instanceof ReadError ? e.message : "not a plan, a workflow or an environment"}`);
    }
  }

  if (!doc) {
    showBanner("Nothing to draw yet.", [
      ...rejected.map(escapeHtml),
      "Drop a plan — <code>ofp-schedule schedule … -o plan.yaml</code> writes one.",
    ]);
    return;
  }

  state.gate = gate;
  state.blurb = accepted.join(", ");
  state.source = files.map((f) => f.name).join("  ·  ");
  state.scene = buildScene(doc, env, workflow);
  renderAll();
  if (rejected.length) showBanner("Some files were not used.", rejected.map(escapeHtml));
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
