import "./rafshim";
import "@fontsource/overpass/700.css";
import "@fontsource/overpass/600.css";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/overpass-mono/400.css";
import "@fontsource/overpass-mono/600.css";
import "./style.css";

import * as turf from "@turf/turf";
import { Store } from "./state";
import { MapView } from "./mapview";
import { Tools } from "./tools";
import { UI } from "./ui";
import { categorize } from "./categorize";
import { computeScores, type ScoreScope } from "./score";
import type { GeocodeResult } from "./overpass";
import { scenarioFor, type Scenario } from "./scenario";
import { renderReport } from "./report";
import { TileManager } from "./tiles";
import type { Feature, Scores } from "./types";

const MCLEAN = {
  slug: "mclean",
  name: "McLean, Virginia",
  center: [-77.1773, 38.9339] as [number, number],
  zoom: 15.1,
};

const app = document.querySelector<HTMLDivElement>("#app")!;
const mapEl = document.createElement("div");
mapEl.id = "map";
app.appendChild(mapEl);

const store = new Store();
const view = new MapView(mapEl, MCLEAN.center, MCLEAN.zoom);
const tools = new Tools(store, view);

let lensOn = false;
let activeScenario: Scenario | null = null;
let lastScores: Scores | null = null;

/** The review always grades the district on the drafting table: a 3 km
 * radius around wherever the camera is looking. */
function currentScope(): ScoreScope & { refLat: number } {
  const c = view.map.getCenter();
  return { center: [c.lng, c.lat], radiusM: 3000, refLat: c.lat };
}

const ui = new UI(
  app,
  store,
  tools,
  {
    onSearchPick: (r: GeocodeResult) => {
      view.flyTo([r.lon, r.lat], 15);
      ui.toast(`Heading to ${r.name}. The survey fills in as you look around.`, true);
    },
    onToggleLens: () => {
      lensOn = !lensOn;
      view.setLens(lensOn);
      return lensOn;
    },
    onStartProject: () => {
      const sc = scenarioFor(store.place.slug);
      if (!sc) return;
      activeScenario = sc;
      store.setMode("project", sc.budget);
      ui.toast(`${sc.name} is open. ${sc.brief}`, true);
    },
    onEndProject: () => {
      activeScenario = null;
      store.setMode("sandbox");
      ui.updateScenario(null);
    },
    onExportReport: () => void exportReport(),
  },
  () => scenarioFor(store.place.slug),
);

const tiles = new TileManager(store, view);
tiles.onStatus = (inflight, queued) => ui.setSurveying(inflight + queued);
tiles.onLimit = () =>
  ui.toast("The drafting table is full. Distant unedited areas will be set aside as you roam.", false);

let scoreTimer: number | undefined;
function scheduleScore(): void {
  window.clearTimeout(scoreTimer);
  scoreTimer = window.setTimeout(() => {
    const features = store.features();
    const scope = currentScope();
    const scores = computeScores(features, scope.refLat, scope);
    lastScores = scores;
    ui.updateScores(scores);
    view.setScores(scores);
    if (store.mode === "project" && activeScenario) {
      ui.updateScenario(activeScenario.evaluate(store, scores), activeScenario.brief);
    } else {
      ui.updateScenario(null);
    }
  }, 300);
}

store.on("change", () => {
  view.refresh(store.features());
  const sel = store.selectedId ? store.get(store.selectedId) : null;
  view.setSelection(sel ?? null);
  if (store.selectedId && !sel) store.select(null);
  scheduleScore();
});

store.on("selection", () => {
  const sel = store.selectedId ? store.get(store.selectedId) : null;
  view.setSelection(sel ?? null);
});

store.on("place", () => {
  // Resume a project if the save says one was open.
  activeScenario = store.mode === "project" ? scenarioFor(store.place.slug) : null;
});

// The reviewed district follows the camera.
view.map.on("moveend", () => scheduleScore());

store.on("mode", () => {
  // Imports can flip the mode without going through the project buttons.
  activeScenario = store.mode === "project" ? scenarioFor(store.place.slug) : null;
});

async function loadMclean(): Promise<void> {
  ui.showOverlay("Unrolling the McLean sheet…");
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/mclean.geo.json`);
    if (!res.ok) {
      throw new Error(`Could not load the McLean map data (HTTP ${res.status}). Reload to try again.`);
    }
    const raw = await res.json();
    const features = categorize(raw);
    store.loadPlace(MCLEAN, features);
    view.flyTo(MCLEAN.center, MCLEAN.zoom);
  } catch (err) {
    ui.toast(String((err as Error).message ?? err), false);
  } finally {
    ui.showOverlay(null);
  }
}


// ---- little trains running the rails -------------------------------------
interface TrainState {
  lineId: string;
  pos: number;
  dir: 1 | -1;
  color: string;
}
const railLines = new Map<
  string,
  { f: Feature; lenM: number; color: string; speed: number }
>();
let trains: TrainState[] = [];

function rebuildTrains(): void {
  railLines.clear();
  for (const f of store.features()) {
    if (f.properties.kind !== "rail" || f.geometry.type !== "LineString") continue;
    let lenM = 0;
    try {
      lenM = turf.length(f as never, { units: "kilometers" }) * 1000;
    } catch {
      continue;
    }
    if (lenM < 700) continue;
    const light = f.properties.railKind === "lightrail";
    railLines.set(f.properties.id, {
      f,
      lenM,
      color: (f.properties.lineColor as string) ?? (light ? "#2E6B4F" : "#8E959C"),
      speed: light ? 70 : 110,
    });
  }
  trains = [];
  for (const [lineId, line] of railLines) {
    if (trains.length >= 40) break;
    const n = Math.max(1, Math.min(3, Math.round(line.lenM / 2500)));
    for (let i = 0; i < n; i++) {
      trains.push({
        lineId,
        pos: (line.lenM / n) * i,
        dir: i % 2 ? -1 : 1,
        color: line.color,
      });
    }
  }
  if (!trains.length) view.setTrains([]);
}

store.on("change", rebuildTrains);
store.on("place", rebuildTrains);

let lastTick = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.2, (now - lastTick) / 1000);
  lastTick = now;
  if (trains.length) {
    const feats: Feature[] = [];
    for (const tr of trains) {
      const line = railLines.get(tr.lineId);
      if (!line) continue;
      tr.pos += tr.dir * line.speed * dt;
      if (tr.pos >= line.lenM) {
        tr.pos = line.lenM;
        tr.dir = -1;
      } else if (tr.pos <= 0) {
        tr.pos = 0;
        tr.dir = 1;
      }
      try {
        const pt = turf.along(line.f as never, tr.pos / 1000);
        feats.push({
          type: "Feature",
          geometry: pt.geometry,
          properties: { id: `train-${tr.lineId}-${feats.length}`, kind: "poi", lineColor: tr.color },
        } as Feature);
      } catch {
        continue;
      }
    }
    view.setTrains(feats);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---- exportable district review ------------------------------------------
async function exportReport(): Promise<void> {
  await document.fonts.ready;
  const scope = currentScope();
  const after = lastScores ?? computeScores(store.features(), scope.refLat, scope);
  // Baseline: the same district as OpenStreetMap found it, no edits applied.
  const before = computeScores([...store.base.values()], scope.refLat, scope);
  const features = store.features();

  const parkingNow = features
    .filter((f) => f.properties.kind === "parking")
    .reduce((s, f) => s + (f.properties.areaM2 ?? 0), 0);
  const parkingRemovedM2 = Math.max(0, store.baselineParkingM2 - parkingNow);
  const railKmBuilt =
    features
      .filter((f) => f.properties.kind === "rail" && f.properties.isNew && f.geometry.type === "LineString")
      .reduce((s, f) => {
        try {
          return s + turf.length(f as never, { units: "kilometers" });
        } catch {
          return s;
        }
      }, 0);
  const canvas = renderReport({
    placeName: store.place.name,
    dateText: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    before,
    after,
    parkingRemovedM2,
    parkingRemovedPct:
      store.baselineParkingM2 > 0 ? parkingRemovedM2 / store.baselineParkingM2 : 0,
    railKmBuilt,
    stationsAdded: features.filter(
      (f) => f.properties.kind === "station" && f.properties.isNew,
    ).length,
    buildingsAdded: features.filter(
      (f) => f.properties.kind === "building" && f.properties.isNew,
    ).length,
    greenAddedM2: features
      .filter(
        (f) =>
          (f.properties.kind === "green" || f.properties.kind === "plaza") &&
          f.properties.isNew,
      )
      .reduce((s, f) => s + (f.properties.areaM2 ?? 0), 0),
    streetsImproved: features.filter(
      (f) => f.properties.kind === "road" && (f.properties.streetscape || f.properties.treeLined),
    ).length,
    spent: store.mode === "project" ? store.spent() : undefined,
    budget: store.mode === "project" ? store.budgetTotal : undefined,
  });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `upzone-review-${store.place.slug}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    ui.toast("District review sheet downloaded.", true);
  }, "image/png");
}

void loadMclean();

// Debug handle for the browser console.
declare global {
  interface Window {
    upzone?: { store: Store; view: MapView };
  }
}
window.upzone = { store, view };
