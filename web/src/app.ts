/**
 * The application: load a plan, draw it, let someone read it.
 *
 * Four ways in (design.md D9): a bundled dataset named by `?doc=`, files
 * dropped on the window, and — from P2 — a share link and an external URL.
 * Everything else here is state: which dataset, which view, what is selected.
 */

import { parse as parseYaml } from "yaml";

import { GANTT_VIEWS, type GanttView } from "./layout/gantt";
import {
  ancestorKeys,
  buildGraph,
  compositeKeys,
  visibleFor,
  type GraphNode,
} from "./model/graph";
import { activitiesUnder, buildScene, sameArc, type Scene } from "./model/scene";
import { copyShareLink, el, escapeHtml, placeTip, wireGraphPointer, wireSplitter } from "./interactions";
import type { ExecutionDocument } from "./model/document";
import type { Environment } from "./model/environment";
import type { Workflow } from "./model/workflow";
import { decodeShare } from "./share";
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
import { renderGraph } from "./view/graph";
import {
  renderInspector,
  renderNodeDetail,
  renderWorkflowOverview,
  statusLine,
  tooltipFor,
} from "./view/inspector";
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

/** What is picked, in whichever pane the person picked it. */
type Selection = { kind: "activity"; index: number } | { kind: "node"; key: string };

interface State {
  index: DatasetIndexEntry[];
  scene?: Scene;
  graph?: GraphNode;
  expanded: Set<string>;
  blurb: string;
  source: string;
  gate?: GateReport;
  view: GanttView;
  zoom: number;
  graphZoom: number;
  labels: boolean;
  selected?: Selection;
  geometry?: GanttGeometry;
  split: number;
  /** Kept so a share link can carry exactly what was loaded. */
  raw?: { plan: unknown; workflow: unknown; environment: unknown };
}

const state: State = {
  index: [],
  expanded: new Set(),
  blurb: "",
  source: "",
  view: "device",
  zoom: 1,
  graphZoom: 1,
  labels: true,
  split: 42,
};

/* ── what lights up ─────────────────────────────────────────────────────
   One selection, two panes. An activity names a node path, and the box that
   stands for it may be an ancestor if that ancestor is closed (D11); a node
   stands for everything beneath it. Both directions are lookups into indices
   the scene already built. */

function litActivities(): Set<number> {
  const scene = state.scene;
  const sel = state.selected;
  const out = new Set<number>();
  if (!scene || !sel) return out;

  if (sel.kind === "activity") {
    for (const i of sameArc(scene, sel.index)) out.add(i);
    return out;
  }
  for (const i of activitiesUnder(scene, sel.key === "" ? [] : sel.key.split("."))) out.add(i);
  return out;
}

interface Highlight {
  readonly lit: Set<string>;
  readonly onPath: Set<string>;
  /** The single connection a selected move serves, if that is the selection. */
  readonly arc?: { fromKey: string; fromPort: string; toKey: string; toPort: string };
  /** The box whose internal dataflow to trace, if that is the selection. */
  readonly subtree?: string;
}

function litNodes(): Highlight {
  const lit = new Set<string>();
  const onPath = new Set<string>();
  const graph = state.graph;
  const scene = state.scene;
  const sel = state.selected;
  if (!graph || !sel) return { lit, onPath };

  if (sel.kind === "node") {
    lit.add(sel.key);
    for (const k of ancestorKeys(sel.key === "" ? [] : sel.key.split("."))) onPath.add(k);
    return { lit, onPath, subtree: sel.key };
  }
  if (scene) {
    const activity = scene.activities[sel.index];
    if (activity) {
      const paths =
        activity.kind === "processing"
          ? [activity.node]
          : activity.kind === "transport" || activity.kind === "relay"
            ? [activity.arc.from.node, activity.arc.to.node]
            : [];
      for (const path of paths) {
        const key = visibleFor(graph, path, state.expanded);
        if (key !== undefined) lit.add(key);
        for (const k of ancestorKeys(path)) onPath.add(k);
      }

      // A move serves one connection. Name it, so one edge traces rather than
      // everything that happens to touch either end.
      if (activity.kind === "transport" || activity.kind === "relay") {
        const fromKey = visibleFor(graph, activity.arc.from.node, state.expanded);
        const toKey = visibleFor(graph, activity.arc.to.node, state.expanded);
        if (fromKey !== undefined && toKey !== undefined) {
          for (const k of lit) onPath.delete(k);
          return {
            lit,
            onPath,
            arc: {
              fromKey,
              fromPort: activity.arc.from.port,
              toKey,
              toPort: activity.arc.to.port,
            },
          };
        }
      }
    }
  }
  for (const k of lit) onPath.delete(k);
  return { lit, onPath };
}

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

  const shared = await decodeShare(location.hash);
  if (shared) {
    adopt(
      {
        plan: shared.plan,
        workflow: shared.workflow ?? null,
        environment: shared.environment ?? null,
      },
      "shared link",
      "Opened from a shared link.",
    );
    if (shared.ui?.view) state.view = shared.ui.view as GanttView;
    if (shared.ui?.expanded) state.expanded = new Set(shared.ui.expanded);
    buildViewButtons();
    markExternal("shared link");
    renderAll();
    requestAnimationFrame(() => fitGraph());
    return;
  }

  const wanted = new URLSearchParams(location.search).get("doc");
  const first = state.index.find((d) => d.id === wanted) ?? state.index[state.index.length - 1];
  if (first) {
    picker.value = first.id;
    await loadDataset(first.id);
    fitGraph();
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

  adopt(
    payload,
    [payload.source.plan, payload.source.workflow, payload.source.environment]
      .filter(Boolean)
      .join("  ·  "),
    payload.blurb,
  );
  renderAll();
}

/** Take a set of raw documents as the thing on screen. */
function adopt(
  raw: { plan: unknown; workflow: unknown; environment: unknown },
  source: string,
  blurb: string,
): void {
  // A workflow stands on its own — it can be read before anything has been
  // scheduled from it, and that is when the feature gate is most useful. Only
  // the plan pane needs a plan.
  const doc = raw.plan ? readExecutionDocument(raw.plan) : undefined;
  const env = raw.environment ? readEnvironment(raw.environment) : undefined;
  const workflow = raw.workflow ? readWorkflow(raw.workflow) : undefined;

  state.gate = raw.workflow ? gateWorkflow(raw.workflow) : undefined;
  state.blurb = blurb;
  state.source = source;
  state.selected = undefined;
  state.zoom = 1;
  state.graphZoom = 1;
  state.expanded = new Set();
  state.scene = doc ? buildScene(doc, env, workflow) : undefined;
  state.graph = workflow ? buildGraph(workflow) : undefined;
  state.raw = raw;
}

/* ── rendering ─────────────────────────────────────────────────────────── */

function renderAll(): void {
  const scene = state.scene;
  const graph = state.graph;
  const sel = state.selected;

  el("ro-outcome").textContent = scene?.doc.outcome ?? "—";
  el("ro-makespan").textContent = scene ? formatDuration(scene.metrics.makespan, scene.unit) : "—";
  el("ro-count").textContent = scene ? String(scene.activities.length) : "—";
  el("status-source").textContent = state.source;

  el("status-selection").textContent =
    sel?.kind === "node"
      ? `Selected node · ${sel.key || graph?.process || "entry"}`
      : scene
        ? statusLine(scene, sel?.kind === "activity" ? sel.index : undefined)
        : "Nothing selected — click a box";

  el("inspector").innerHTML =
    sel?.kind === "node" && graph
      ? renderNodeDetail(graph, sel.key, scene)
      : scene
        ? renderInspector(scene, sel?.kind === "activity" ? sel.index : undefined, state.blurb)
        : graph
          ? renderWorkflowOverview(graph, state.blurb)
          : "";

  renderBanner();
  renderLegend();
  renderGraphPane();
  renderChart();
}

function renderGraphPane(): void {
  const graph = state.graph;
  const host = el<SVGSVGElement & HTMLElement>("graph");
  const hint = el("graph-hint");

  if (!graph) {
    host.removeAttribute("width");
    host.removeAttribute("height");
    host.innerHTML = "";
    hint.textContent = "No workflow was loaded with this plan.";
    return;
  }

  const { lit, onPath, arc, subtree } = litNodes();
  const g = renderGraph(graph, {
    expanded: state.expanded,
    lit,
    onPath,
    ...(arc ? { arc } : {}),
    ...(subtree !== undefined ? { subtree } : {}),
  });
  host.setAttribute("viewBox", `-2 -2 ${g.width} ${g.height}`);
  host.setAttribute("width", String(Math.round(g.width * state.graphZoom)));
  host.setAttribute("height", String(Math.round(g.height * state.graphZoom)));
  host.innerHTML = g.svg;

  hint.textContent =
    `${graph.process} · ${graph.atomicCount} atomic steps · ` +
    (state.scene ? "click a box to link it to the plan" : "click a box for what it is");
}

function fitGraph(attempt = 0): void {
  const graph = state.graph;
  if (!graph) return;
  const box = el("graph-scroll");

  // Fitting against a box the browser has not laid out yet produces a postage
  // stamp. Wait a frame — but not forever, since the pane really can be this
  // small once the divider is dragged up.
  if ((box.clientWidth < 120 || box.clientHeight < 80) && attempt < 12) {
    requestAnimationFrame(() => fitGraph(attempt + 1));
    return;
  }

  const g = renderGraph(graph, { expanded: state.expanded, lit: new Set(), onPath: new Set() });
  const scale = Math.min((box.clientWidth - 36) / g.width, (box.clientHeight - 36) / g.height);
  state.graphZoom = Math.max(0.3, Math.min(1.5, scale));
  renderGraphPane();
}

/** Only the marks this plan actually uses — a legend for things that are not
 *  on screen is noise, and it hides the one that is. */
function renderLegend(): void {
  const scene = state.scene;
  if (!scene) {
    el("legend").innerHTML = "";
    return;
  }
  const counts = scene.metrics.counts;
  const held = scene.activities.some((a) => a.kind === "transport" && a.transporter);
  const items: [boolean, string, string][] = [
    [counts.processing > 0, "processing", "processing"],
    [counts.transport > 0, "transport", "transport"],
    [held, "held", "device held"],
    [counts.relay > 0, "relay", "relay"],
    [counts.replenishment > 0, "replenishment", "refill"],
  ];
  el("legend").innerHTML = items
    .filter(([on]) => on)
    .map(([, cls, label]) => `<span class="lg"><i class="sw ${cls}"></i>${label}</span>`)
    .join("");
}

function renderChart(): void {
  const scene = state.scene;
  el("plan-empty").hidden = !!scene;
  el("chart").hidden = !scene;
  for (const id of ["labels", "zoom-in", "zoom-out", "zoom-fit", "export"])
    el<HTMLButtonElement>(id).disabled = !scene;
  for (const b of el("views").querySelectorAll("button")) (b as HTMLButtonElement).disabled = !scene;
  if (!scene) return;

  // Measured from the pane, never from the scrolling row: the row is sized by
  // what is inside it, so measuring there feeds each zoom back into the next
  // one. The gutter sits inside that width, so the plot gets what is left.
  const base = Math.max(360, el("chart").clientWidth - GUTTER_W - 18);
  const lit = litActivities();

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

const DROPPED = "__external__";

/**
 * What is on screen did not come from the list, so the list must stop claiming
 * it did — and the `?doc=` in the address bar must stop pointing at a plan
 * nobody is looking at.
 */
function markExternal(label: string): void {
  const picker = el<HTMLSelectElement>("dataset");
  let option = picker.querySelector<HTMLOptionElement>(`option[value="${DROPPED}"]`);
  if (!option) {
    option = document.createElement("option");
    option.value = DROPPED;
    picker.prepend(option);
  }
  option.textContent = label;
  picker.value = DROPPED;

  const url = new URL(location.href);
  url.searchParams.delete("doc");
  history.replaceState(null, "", url);
}

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
    const id = (e.target as HTMLSelectElement).value;
    if (id === DROPPED) return;
    void loadDataset(id).then(() => fitGraph());
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

  el("expand-all").addEventListener("click", () => {
    if (!state.graph) return;
    state.expanded = new Set(compositeKeys(state.graph));
    // Deliberately not fitted: twenty-two steps in a row shrink to a smear.
    // Full size and scrollable beats visible and unreadable.
    state.graphZoom = 1;
    renderAll();
    el("graph-scroll").scrollTo({ top: 0, left: 0 });
  });
  el("collapse-all").addEventListener("click", () => {
    state.expanded = new Set();
    renderAll();
    fitGraph();
  });
  el("graph-in").addEventListener("click", () => {
    state.graphZoom = Math.min(2.4, state.graphZoom * 1.25);
    renderGraphPane();
  });
  el("graph-out").addEventListener("click", () => {
    state.graphZoom = Math.max(0.25, state.graphZoom / 1.25);
    renderGraphPane();
  });
  el("graph-fit").addEventListener("click", () => fitGraph());
  el("share").addEventListener("click", () => {
    const raw = state.raw;
    if (!raw || (!raw.plan && !raw.workflow)) return;
    void copyShareLink(
      {
        ...(raw.plan ? { plan: raw.plan } : {}),
        ...(raw.workflow ? { workflow: raw.workflow } : {}),
        ...(raw.environment ? { environment: raw.environment } : {}),
        ui: { view: state.view, expanded: [...state.expanded] },
      },
      flash,
      (headline, detail) => showBanner(headline, [escapeHtml(detail)]),
    );
  });

  wireGraphPointer({
    graph: () => state.graph,
    expanded: () => state.expanded,
    onToggle: (key) => {
      if (state.expanded.has(key)) state.expanded.delete(key);
      else state.expanded.add(key);
      renderAll();
    },
    onSelect: (key) => select(key === undefined ? undefined : { kind: "node", key }),
  });
  wireSplitter(
    () => state.split,
    (pct) => {
      state.split = pct;
    },
    renderChart,
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") select(undefined);
  });

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderChart();
      renderGraphPane();
    }, 120);
  });
}

function same(a: Selection | undefined, b: Selection | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "activity" ? a.index === (b as typeof a).index : a.key === (b as typeof a).key;
}

/** Picking the same thing twice puts it down. */
function select(next: Selection | undefined): void {
  state.selected = same(state.selected, next) ? undefined : next;
  renderAll();
}

/* ── pointer ───────────────────────────────────────────────────────────── */

function wirePointer(): void {
  const plot = el("plot");
  const tip = el("tip");

  plot.addEventListener("click", (e) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    select(hit ? { kind: "activity", index: Number(hit.dataset["i"]) } : undefined);
  });

  plot.addEventListener("mousemove", (e) => {
    const scene = state.scene;
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!scene || !hit) {
      tip.style.display = "none";
      return;
    }
    tip.innerHTML = tooltipFor(scene, Number(hit.dataset["i"]));
    placeTip(tip, e);
  });

  plot.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

/* ── dropped files ─────────────────────────────────────────────────────── */

/**
 * Files are sorted by what they turn out to be, not by their name: the reader
 * that accepts a file decides.
 *
 * A drop replaces the whole set rather than merging into what is loaded. The
 * alternative is worse than it sounds — dropping one workflow onto another
 * plan pairs two documents that have nothing to do with each other, and the
 * viewer would draw the mismatch without a word. To see a plan against its
 * workflow, drop both; the banner says what each file was taken as.
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

  let doc: ExecutionDocument | undefined;
  let env: Environment | undefined;
  let workflow: Workflow | undefined;
  let gate: GateReport | undefined;
  let rawPlan: unknown = null;
  let rawWorkflow: unknown = null;
  let rawEnvironment: unknown = null;
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    const text = await file.text();
    try {
      doc = readExecutionDocumentText(text);
      rawPlan = parseYaml(text);
      accepted.push(`${file.name} → plan`);
      state.selected = undefined;
      continue;
    } catch {
      /* not a plan; try the next shape */
    }
    try {
      workflow = readWorkflowText(text);
      rawWorkflow = parseYaml(text);
      gate = gateWorkflow(rawWorkflow);
      accepted.push(`${file.name} → workflow`);
      state.selected = undefined;
      continue;
    } catch {
      /* not a workflow */
    }
    try {
      env = readEnvironmentText(text);
      rawEnvironment = parseYaml(text);
      accepted.push(`${file.name} → environment`);
      continue;
    } catch (e) {
      rejected.push(`${file.name} — ${e instanceof ReadError ? e.message : "not a plan, a workflow or an environment"}`);
    }
  }

  if (!doc && !workflow) {
    showBanner("Nothing to draw yet.", [
      ...rejected.map(escapeHtml),
      "Drop a workflow to read it, or a plan to see when its steps run — " +
        "<code>ofp-schedule schedule … -o plan.yaml</code> writes one.",
    ]);
    return;
  }

  state.gate = gate;
  state.selected = undefined;
  state.blurb = accepted.join(", ");
  state.source = files.map((f) => f.name).join("  ·  ");
  state.scene = doc ? buildScene(doc, env, workflow) : undefined;
  state.graph = workflow ? buildGraph(workflow) : undefined;
  state.expanded = new Set();
  state.raw = { plan: rawPlan, workflow: rawWorkflow, environment: rawEnvironment };
  markExternal(files.length === 1 ? files[0]!.name : `${files.length} dropped files`);
  renderAll();
  fitGraph();
  if (rejected.length) showBanner("Some files were not used.", rejected.map(escapeHtml));
}


let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** A transient line in the status strip; the selection returns after it. */
function flash(message: string): void {
  const status = el("status-selection");
  const previous = status.textContent ?? "";
  status.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    status.textContent = previous;
  }, 4000);
}
