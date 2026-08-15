// Tool state machine: selection, bulldozer, aligned building placement, and
// vertex-by-vertex drawing for streets and light rail, with snapping.
import type { MapMouseEvent } from "maplibre-gl";
import type { Feature } from "./types";
import type { Store } from "./state";
import type { MapView } from "./mapview";
import { distM, GridIndex, makeProj, type Proj } from "./geometry";

function totalM(coords: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) m += distM(coords[i - 1], coords[i]);
  return m;
}
import {
  addRail,
  addRoad,
  addStation,
  BUILDING_PRESETS,
  demolish,
  placeBuilding,
  presetFootprint,
  type BuildingPreset,
} from "./edits";

export type ToolName =
  | "select"
  | "bulldoze"
  | "build"
  | "trace"
  | "road"
  | "rail"
  | "station";

const DRAWING: ToolName[] = ["road", "rail", "trace"];

const SNAP_M = 18;

export class Tools {
  active: ToolName = "select";
  preset: BuildingPreset = BUILDING_PRESETS[0];
  draft: [number, number][] = [];
  onToolChange: (() => void) | null = null;
  onActionResult: ((msg: string, ok: boolean) => void) | null = null;
  onDraftChange: ((vertices: number, lengthM: number) => void) | null = null;

  private snapIdx: GridIndex<[number, number]> | null = null;
  private proj: Proj | null = null;
  private hoverLL: [number, number] | null = null;

  constructor(
    private store: Store,
    private view: MapView,
  ) {
    const map = view.map;
    map.on("click", (e) => this.click(e));
    map.on("dblclick", (e) => {
      if (DRAWING.includes(this.active)) {
        e.preventDefault();
        this.finishDraft();
      }
    });
    map.on("mousemove", (e) => this.move(e));
    window.addEventListener("keydown", (e) => this.key(e));
    store.on("change", () => this.rebuildSnap());
    store.on("place", () => {
      this.rebuildSnap();
      this.setTool("select");
    });
  }

  setTool(t: ToolName): void {
    this.active = t;
    this.draft = [];
    this.view.setDraft([]);
    this.view.setGhost([]);
    const drawing = DRAWING.includes(t);
    if (drawing || t === "build" || t === "station") this.view.setCursor("crosshair");
    else if (t === "bulldoze") this.view.setCursor("not-allowed");
    else this.view.setCursor("");
    if (drawing) this.view.map.doubleClickZoom.disable();
    else this.view.map.doubleClickZoom.enable();
    this.onToolChange?.();
    this.onDraftChange?.(0, 0);
  }

  setPreset(p: BuildingPreset): void {
    this.preset = p;
    if (this.hoverLL) this.updateGhost(this.hoverLL);
  }

  private rebuildSnap(): void {
    this.proj = makeProj(this.store.place.center[1] || 38.9);
    const idx = new GridIndex<[number, number]>(60);
    for (const f of this.store.features()) {
      if (f.properties.kind !== "road" || f.geometry.type !== "LineString") continue;
      for (const c of f.geometry.coordinates) {
        const [x, y] = this.proj.toXY(c[0], c[1]);
        idx.insert(x, y, c as [number, number]);
      }
    }
    this.snapIdx = idx;
  }

  private snap(ll: [number, number]): [number, number] {
    if (!this.snapIdx || !this.proj || this.active !== "road") return ll;
    const [x, y] = this.proj.toXY(ll[0], ll[1]);
    const near = this.snapIdx.query(x, y, SNAP_M);
    if (!near.length) return ll;
    near.sort((a, b) => a.d2 - b.d2);
    return near[0].item;
  }

  private click(e: MapMouseEvent): void {
    const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    switch (this.active) {
      case "select": {
        const id = this.view.pick(e.point);
        this.store.select(id);
        break;
      }
      case "bulldoze": {
        const id = this.view.pick(e.point);
        if (!id) return;
        const f = this.store.get(id);
        if (!f) return;
        const p = f.properties;
        const demolishable =
          p.kind === "building" || p.kind === "parking" ||
          (p.isNew === true && (p.kind === "road" || p.kind === "rail" || p.kind === "station" || p.kind === "green" || p.kind === "plaza"));
        if (!demolishable) {
          this.onActionResult?.("Only buildings, parking lots, and your own additions can be bulldozed.", false);
          return;
        }
        const action = demolish(f);
        const res = this.store.apply(action);
        this.onActionResult?.(res.ok ? action.label : res.reason ?? "", res.ok);
        break;
      }
      case "build": {
        const fp = presetFootprint(this.store, ll, this.preset);
        const action = placeBuilding(this.store, fp.geometry, this.preset);
        const res = this.store.apply(action);
        this.onActionResult?.(res.ok ? action.label : res.reason ?? "", res.ok);
        break;
      }
      case "road":
      case "rail":
      case "trace": {
        this.draft.push(this.snap(ll));
        this.renderDraft(ll);
        break;
      }
      case "station": {
        const action = addStation(this.store, ll);
        if ("error" in action) {
          this.onActionResult?.(action.error, false);
          return;
        }
        const res = this.store.apply(action);
        this.onActionResult?.(res.ok ? action.label : res.reason ?? "", res.ok);
        break;
      }
    }
  }

  private move(e: MapMouseEvent): void {
    const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    this.hoverLL = ll;
    if (this.active === "build") this.updateGhost(ll);
    else if (DRAWING.includes(this.active) && this.draft.length) {
      this.renderDraft(ll);
    }
  }

  private updateGhost(ll: [number, number]): void {
    const fp = presetFootprint(this.store, ll, this.preset);
    this.view.setGhost([
      {
        type: "Feature",
        geometry: fp.geometry,
        properties: { id: "ghost", kind: "building" },
      } as Feature,
    ]);
  }

  private renderDraft(cursor?: [number, number]): void {
    const feats: Feature[] = this.draft.map(
      (c, i) =>
        ({
          type: "Feature",
          geometry: { type: "Point", coordinates: c },
          properties: { id: `d${i}`, kind: "poi" },
        }) as Feature,
    );
    const lineCoords = cursor ? [...this.draft, this.snap(cursor)] : this.draft;
    if (this.active === "trace" && lineCoords.length >= 3) {
      feats.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[...lineCoords, lineCoords[0]]],
        },
        properties: { id: "dpoly", kind: "building" },
      } as Feature);
    } else if (lineCoords.length >= 2) {
      feats.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: lineCoords },
        properties: { id: "dline", kind: "road" },
      } as Feature);
    }
    this.view.setDraft(feats);
    this.onDraftChange?.(this.draft.length, totalM(this.draft));
  }

  finishDraft(): void {
    // A double-click fires two map clicks before dblclick, leaving duplicate
    // trailing vertices; drop consecutive near-duplicates before committing.
    const coords = this.draft.filter(
      (c, i, a) => i === 0 || distM(c, a[i - 1]) > 1,
    );
    if (this.active === "trace") {
      if (coords.length < 3) {
        this.cancelDraft();
        return;
      }
      const geometry: GeoJSON.Polygon = {
        type: "Polygon",
        coordinates: [[...coords, coords[0]]],
      };
      const action = placeBuilding(this.store, geometry, this.preset);
      const res = this.store.apply(action);
      this.onActionResult?.(res.ok ? action.label : res.reason ?? "", res.ok);
    } else {
      if (coords.length < 2 || totalM(coords) < 10) {
        this.cancelDraft();
        return;
      }
      const action =
        this.active === "road"
          ? addRoad(this.store, coords)
          : addRail(this.store, coords);
      const res = this.store.apply(action);
      this.onActionResult?.(res.ok ? action.label : res.reason ?? "", res.ok);
    }
    this.draft = [];
    this.view.setDraft([]);
    this.onDraftChange?.(0, 0);
  }

  cancelDraft(): void {
    this.draft = [];
    this.view.setDraft([]);
    this.onDraftChange?.(0, 0);
  }

  private key(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "Escape") {
      if (this.draft.length) this.cancelDraft();
      else {
        this.store.select(null);
        this.setTool("select");
      }
    } else if (e.key === "Enter" && DRAWING.includes(this.active)) {
      this.finishDraft();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.store.redo();
    }
  }
}
