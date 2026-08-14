import "./rafshim";
import "@fontsource/overpass/700.css";
import "@fontsource/overpass/600.css";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/overpass-mono/400.css";
import "@fontsource/overpass-mono/600.css";
import "./style.css";

import { Store } from "./state";
import { MapView } from "./mapview";
import { Tools } from "./tools";
import { UI } from "./ui";
import { categorize } from "./categorize";
import { computeScores } from "./score";
import { fetchArea, type GeocodeResult } from "./overpass";
import { scenarioFor, type Scenario } from "./scenario";

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

const ui = new UI(
  app,
  store,
  tools,
  {
    onSearchPick: (r) => void loadRemotePlace(r),
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
  },
  () => scenarioFor(store.place.slug),
);

let scoreTimer: number | undefined;
function scheduleScore(): void {
  window.clearTimeout(scoreTimer);
  scoreTimer = window.setTimeout(() => {
    const features = store.features();
    const scores = computeScores(features, store.place.center[1]);
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

async function loadMclean(): Promise<void> {
  ui.showOverlay("Unrolling the McLean sheet…");
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/mclean.geo.json`);
    const raw = await res.json();
    const features = categorize(raw);
    store.loadPlace(MCLEAN, features);
    view.flyTo(MCLEAN.center, MCLEAN.zoom);
  } finally {
    ui.showOverlay(null);
  }
}

async function loadRemotePlace(r: GeocodeResult): Promise<void> {
  ui.showOverlay(`Surveying ${r.name}…`);
  try {
    const raw = await fetchArea(r.lat, r.lon, (msg) => ui.showOverlay(msg));
    const features = categorize(raw);
    if (features.length < 20) {
      ui.toast("OpenStreetMap has almost nothing mapped there. Try somewhere more built up.", false);
      return;
    }
    store.loadPlace(
      { slug: r.slug, name: r.name, center: [r.lon, r.lat], zoom: 14.8 },
      features,
    );
    view.flyTo([r.lon, r.lat], 14.8);
  } catch (err) {
    ui.toast(String((err as Error).message ?? err), false);
  } finally {
    ui.showOverlay(null);
  }
}

void loadMclean();

// Debug handle for the browser console.
declare global {
  interface Window {
    upzone?: { store: Store; view: MapView };
  }
}
window.upzone = { store, view };
