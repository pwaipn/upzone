// MapLibre rendering: one consistent plan-sheet drawing built entirely from
// our own GeoJSON, extruded where the city stands up.
import {
  Map as MLMap,
  NavigationControl,
  AttributionControl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FC, Scores } from "./types";
import { THEME } from "./theme";

type XY = { x: number; y: number };

const EMPTY: FC = { type: "FeatureCollection", features: [] };

function fc(features: Feature[]): FC {
  return { type: "FeatureCollection", features };
}

const roadBase: unknown = [
  "match",
  ["get", "roadClass"],
  "motorway", THEME.roadWidth.motorway,
  "primary", THEME.roadWidth.primary,
  "secondary", THEME.roadWidth.secondary,
  "tertiary", THEME.roadWidth.tertiary,
  "residential", THEME.roadWidth.residential,
  "service", THEME.roadWidth.service,
  1.5,
];

type WidthExpr = import("maplibre-gl").DataDrivenPropertyValueSpecification<number>;

function roadWidth(mult: number, add = 0): WidthExpr {
  return [
    "interpolate", ["exponential", 1.6], ["zoom"],
    12, ["+", ["*", roadBase, 0.22 * mult], add * 0.4],
    15, ["+", ["*", roadBase, 0.8 * mult], add],
    18, ["+", ["*", roadBase, 3.4 * mult], add * 1.6],
  ] as unknown as WidthExpr;
}

export class MapView {
  map: MLMap;
  private loaded = false;
  private pendingRefresh: Feature[] | null = null;

  constructor(container: HTMLElement, center: [number, number], zoom: number) {
    this.map = new MLMap({
      container,
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: "bg", type: "background", paint: { "background-color": THEME.mylar } },
        ],
      },
      center,
      zoom,
      pitch: 45,
      bearing: -17,
      maxPitch: 70,
      attributionControl: false,
    });
    this.map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: "Map data © OpenStreetMap contributors",
      }),
      "bottom-right",
    );
    this.map.addControl(
      new NavigationControl({ visualizePitch: true }),
      "bottom-left",
    );
    this.map.on("load", () => {
      this.addSourcesAndLayers();
      this.loaded = true;
      if (this.pendingRefresh) {
        this.refresh(this.pendingRefresh);
        this.pendingRefresh = null;
      }
    });
  }

  private addSourcesAndLayers(): void {
    const m = this.map;
    for (const id of ["areas", "roads", "rails", "buildings", "points", "draft", "ghost", "selection"]) {
      m.addSource(id, { type: "geojson", data: EMPTY, promoteId: "id" });
    }

    m.addLayer({
      id: "zones", type: "fill", source: "areas",
      filter: ["==", ["get", "kind"], "zone"],
      paint: {
        "fill-color": ["match", ["get", "zone"],
          "residential", THEME.zone.residential,
          "commercial", THEME.zone.commercial,
          "industrial", THEME.zone.industrial,
          THEME.mylar],
        "fill-opacity": 0.4,
      },
    });
    m.addLayer({
      id: "green", type: "fill", source: "areas",
      filter: ["all", ["==", ["get", "kind"], "green"], ["==", ["geometry-type"], "Polygon"]],
      paint: { "fill-color": THEME.parkFill, "fill-opacity": 0.75 },
    });
    m.addLayer({
      id: "water", type: "fill", source: "areas",
      filter: ["all", ["==", ["get", "kind"], "water"], ["==", ["geometry-type"], "Polygon"]],
      paint: { "fill-color": THEME.water, "fill-opacity": 0.85 },
    });
    m.addLayer({
      id: "water-line", type: "line", source: "areas",
      filter: ["all", ["==", ["get", "kind"], "water"], ["==", ["geometry-type"], "LineString"]],
      paint: { "line-color": THEME.water, "line-width": 1.6, "line-opacity": 0.8 },
    });
    m.addLayer({
      id: "plaza", type: "fill", source: "areas",
      filter: ["==", ["get", "kind"], "plaza"],
      paint: { "fill-color": "#CBC8BC", "fill-opacity": 1 },
    });
    m.addLayer({
      id: "parking", type: "fill", source: "areas",
      filter: ["==", ["get", "kind"], "parking"],
      paint: { "fill-color": THEME.asphalt, "fill-opacity": 0.82 },
    });
    m.addLayer({
      id: "parking-edge", type: "line", source: "areas",
      filter: ["==", ["get", "kind"], "parking"],
      paint: { "line-color": THEME.ink, "line-width": 0.6, "line-opacity": 0.4 },
    });

    m.addLayer({
      id: "roads-casing", type: "line", source: "roads",
      filter: ["!=", ["get", "roadClass"], "path"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": THEME.ink,
        "line-width": roadWidth(1, 1.6),
        "line-opacity": 0.3,
      },
    });
    m.addLayer({
      id: "roads", type: "line", source: "roads",
      filter: ["!=", ["get", "roadClass"], "path"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "roadClass"],
          "motorway", THEME.road.motorway,
          "primary", THEME.road.primary,
          "secondary", THEME.road.secondary,
          "tertiary", THEME.road.tertiary,
          "residential", THEME.road.residential,
          "service", THEME.road.service,
          THEME.road.residential],
        "line-width": roadWidth(1),
      },
    });
    m.addLayer({
      id: "paths", type: "line", source: "roads",
      filter: ["==", ["get", "roadClass"], "path"],
      paint: {
        "line-color": THEME.road.path,
        "line-width": 1.1,
        "line-dasharray": [2, 2],
        "line-opacity": 0.8,
      },
    });
    m.addLayer({
      id: "road-lens", type: "line", source: "roads",
      filter: ["!=", ["get", "roadClass"], "path"],
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: {
        "line-color": [
          "interpolate", ["linear"],
          ["coalesce", ["feature-state", "walk"], -1],
          0, "#A93A28",
          0.5, THEME.highlighter,
          1, THEME.green,
        ],
        "line-width": roadWidth(1, 1),
        "line-opacity": [
          "case", ["<", ["coalesce", ["feature-state", "walk"], -1], 0], 0, 0.9,
        ],
      },
    });

    m.addLayer({
      id: "rail-metro", type: "line", source: "rails",
      filter: ["==", ["get", "railKind"], "metro"],
      paint: { "line-color": THEME.ink, "line-width": 2.4 },
    });
    m.addLayer({
      id: "rail-metro-dash", type: "line", source: "rails",
      filter: ["==", ["get", "railKind"], "metro"],
      paint: { "line-color": "#FFFFFF", "line-width": 1.2, "line-dasharray": [2.5, 4] },
    });
    m.addLayer({
      id: "rail-light-casing", type: "line", source: "rails",
      filter: ["==", ["get", "railKind"], "lightrail"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": THEME.ink, "line-width": 5, "line-opacity": 0.35 },
    });
    m.addLayer({
      id: "rail-light", type: "line", source: "rails",
      filter: ["==", ["get", "railKind"], "lightrail"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": THEME.green, "line-width": 3.4 },
    });

    m.addLayer({
      id: "buildings", type: "fill-extrusion", source: "buildings",
      paint: {
        "fill-extrusion-color": ["match", ["get", "use"],
          "retail", THEME.building.retail,
          "mixeduse", THEME.building.mixeduse,
          "apartment", THEME.building.apartment,
          "house", THEME.building.house,
          "office", THEME.building.office,
          "civic", THEME.building.civic,
          "garage", THEME.building.garage,
          THEME.building.other],
        "fill-extrusion-height": ["coalesce", ["get", "height"], 4],
        "fill-extrusion-opacity": 0.92,
      },
    });

    m.addLayer({
      id: "new-areas", type: "line", source: "areas",
      filter: ["==", ["get", "isNew"], true],
      paint: { "line-color": THEME.highlighter, "line-width": 2 },
    });
    m.addLayer({
      id: "new-buildings", type: "line", source: "buildings",
      filter: ["==", ["get", "isNew"], true],
      paint: { "line-color": THEME.highlighter, "line-width": 2 },
    });

    m.addLayer({
      id: "pois", type: "circle", source: "points", minzoom: 14.5,
      filter: ["==", ["get", "kind"], "poi"],
      paint: {
        "circle-radius": 2.4,
        "circle-color": THEME.brick,
        "circle-opacity": 0.65,
      },
    });
    m.addLayer({
      id: "stops", type: "circle", source: "points", minzoom: 14,
      filter: ["==", ["get", "kind"], "stop"],
      paint: {
        "circle-radius": 2.6,
        "circle-color": THEME.ink,
        "circle-opacity": 0.45,
      },
    });
    m.addLayer({
      id: "stations", type: "circle", source: "points",
      filter: ["==", ["get", "kind"], "station"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 4, 16, 7],
        "circle-color": ["match", ["get", "railKind"], "lightrail", THEME.green, THEME.ink],
        "circle-stroke-width": 2.2,
        "circle-stroke-color": ["case", ["==", ["get", "isNew"], true], THEME.highlighter, "#FFFFFF"],
      },
    });

    m.addLayer({
      id: "selection-fill", type: "fill", source: "selection",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": THEME.highlighter, "fill-opacity": 0.18 },
    });
    m.addLayer({
      id: "selection-line", type: "line", source: "selection",
      filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
      paint: { "line-color": THEME.highlighter, "line-width": 3 },
    });
    m.addLayer({
      id: "selection-point", type: "circle", source: "selection",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 11,
        "circle-color": "transparent",
        "circle-stroke-width": 3,
        "circle-stroke-color": THEME.highlighter,
      },
    });

    m.addLayer({
      id: "ghost-fill", type: "fill", source: "ghost",
      paint: { "fill-color": THEME.highlighter, "fill-opacity": 0.22 },
    });
    m.addLayer({
      id: "ghost-line", type: "line", source: "ghost",
      paint: { "line-color": THEME.highlighter, "line-width": 2, "line-dasharray": [3, 2] },
    });
    m.addLayer({
      id: "draft-line", type: "line", source: "draft",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": THEME.highlighter, "line-width": 3, "line-dasharray": [2.5, 1.8] },
    });
    m.addLayer({
      id: "draft-points", type: "circle", source: "draft",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 4.2,
        "circle-color": "#FFFFFF",
        "circle-stroke-width": 2.4,
        "circle-stroke-color": THEME.highlighter,
      },
    });
  }

  private setData(id: string, data: FC): void {
    const src = this.map.getSource(id) as GeoJSONSource | undefined;
    if (src) src.setData(data);
  }

  refresh(features: Feature[]): void {
    if (!this.loaded) {
      this.pendingRefresh = features;
      return;
    }
    const areas: Feature[] = [];
    const roads: Feature[] = [];
    const rails: Feature[] = [];
    const buildings: Feature[] = [];
    const points: Feature[] = [];
    for (const f of features) {
      switch (f.properties.kind) {
        case "building": buildings.push(f); break;
        case "road": roads.push(f); break;
        case "rail": rails.push(f); break;
        case "station": case "stop": case "poi": points.push(f); break;
        default: areas.push(f);
      }
    }
    this.setData("areas", fc(areas));
    this.setData("roads", fc(roads));
    this.setData("rails", fc(rails));
    this.setData("buildings", fc(buildings));
    this.setData("points", fc(points));
  }

  setScores(scores: Scores): void {
    if (!this.loaded) return;
    for (const [id, walk] of scores.roadWalk) {
      this.map.setFeatureState({ source: "roads", id }, { walk });
    }
  }

  setLens(on: boolean): void {
    if (!this.loaded) return;
    this.map.setLayoutProperty("road-lens", "visibility", on ? "visible" : "none");
  }

  setSelection(f: Feature | null): void {
    this.setData("selection", f ? fc([f]) : EMPTY);
  }

  setDraft(features: Feature[]): void {
    this.setData("draft", fc(features));
  }

  setGhost(features: Feature[]): void {
    this.setData("ghost", fc(features));
  }

  /** Topmost interesting feature id at a screen point. */
  pick(point: XY): string | null {
    if (!this.loaded) return null;
    const hits = this.map.queryRenderedFeatures(
      [point.x, point.y],
      {
        layers: [
          "stations", "buildings", "parking", "rail-light", "rail-metro",
          "roads", "green", "plaza",
        ].filter((l) => !!this.map.getLayer(l)),
      },
    );
    if (!hits.length) return null;
    const priority = ["station", "building", "parking", "rail", "road", "plaza", "green"];
    hits.sort(
      (a: MapGeoJSONFeature, b: MapGeoJSONFeature) =>
        priority.indexOf(String(a.properties?.kind)) -
        priority.indexOf(String(b.properties?.kind)),
    );
    return (hits[0].properties?.id as string) ?? null;
  }

  setCursor(c: string): void {
    this.map.getCanvas().style.cursor = c;
  }

  flyTo(center: [number, number], zoom: number): void {
    this.map.flyTo({ center, zoom, pitch: 45, bearing: -17, duration: 1600 });
  }
}
