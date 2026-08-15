// Builders that turn player intent into EditActions with costs attached.
import * as turf from "@turf/turf";
import type { BuildingUse, EditAction, Feature } from "./types";
import { COST, METERS_PER_LEVEL, TRANSIT_COLORS } from "./types";
import type { Store } from "./state";
import { buildingColor } from "./categorize";
import {
  inset,
  lineLengthM,
  nearestRoad,
  orientedRect,
  splitLotByRoad,
} from "./geometry";

function label(f: Feature): string {
  return f.properties.name ?? f.properties.kind;
}

export function demolish(f: Feature): EditAction {
  const p = f.properties;
  let cost = 250_000;
  if (p.kind === "building") {
    cost = Math.max(200_000, (p.areaM2 ?? 0) * (p.levels ?? 1) * COST.demoBuildingPerM2Floor);
  } else if (p.kind === "parking") {
    cost = Math.max(50_000, (p.areaM2 ?? 0) * COST.demoParkingPerM2);
  } else if (p.kind === "road" || p.kind === "rail") {
    cost = Math.max(100_000, lineLengthM(f) * 900);
  }
  return { type: "demolish", id: p.id, cost: Math.round(cost), label: `Bulldoze ${label(f)}` };
}

export function remodel(f: Feature, use: BuildingUse, levels: number): EditAction {
  const area = f.properties.areaM2 ?? 300;
  const cost = Math.round(area * levels * COST.buildPerM2Floor * COST.remodelFactor);
  return {
    type: "remodel",
    id: f.properties.id,
    use,
    levels,
    cost,
    label: `Redevelop ${label(f)}`,
  };
}

export type ParkingConversion = "park" | "plaza" | "building" | "behind";

export type StreetscapeMove = "trees" | "diet" | "pedestrianize";

export function restreet(f: Feature, move: StreetscapeMove): EditAction {
  const km = lineLengthM(f) / 1000;
  const id = f.properties.id;
  switch (move) {
    case "trees":
      return {
        type: "restreet",
        id,
        treeLined: true,
        cost: Math.max(50_000, Math.round(km * COST.treesPerKm)),
        label: "Street trees planted",
      };
    case "diet":
      return {
        type: "restreet",
        id,
        streetscape: "dieted",
        treeLined: true,
        cost: Math.max(200_000, Math.round(km * COST.roadDietPerKm)),
        label: "Road diet: bike lanes and trees",
      };
    case "pedestrianize":
      return {
        type: "restreet",
        id,
        streetscape: "pedestrianized",
        treeLined: true,
        cost: Math.max(400_000, Math.round(km * COST.pedestrianizePerKm)),
        label: "Street pedestrianized",
      };
  }
}

export function convertParking(
  store: Store,
  lot: Feature,
  to: ParkingConversion,
): EditAction | { error: string } {
  const p = lot.properties;
  const area = p.areaM2 ?? 0;
  const demoCost = Math.max(50_000, area * COST.demoParkingPerM2);

  if (to === "park" || to === "plaza") {
    const f: Feature = {
      type: "Feature",
      geometry: lot.geometry,
      properties: {
        id: store.newId(),
        kind: to === "park" ? "green" : "plaza",
        areaM2: area,
        isNew: true,
        name: to === "park" ? "New park" : "New plaza",
      },
    };
    const per = to === "park" ? COST.parkPerM2 : COST.plazaPerM2;
    return {
      type: "replace",
      removeId: p.id,
      features: [f],
      cost: Math.round(demoCost + area * per),
      label: to === "park" ? "Parking lot to park" : "Parking lot to plaza",
    };
  }

  if (to === "building") {
    const shrunk = inset(lot as GeoJSON.Feature, 3);
    if (!shrunk) return { error: "This lot is too small or too oddly shaped to build on." };
    const bArea = turf.area(shrunk as never);
    const levels = 3;
    const nid = store.newId();
    const f: Feature = {
      type: "Feature",
      geometry: shrunk.geometry,
      properties: {
        id: nid,
        kind: "building",
        use: "mixeduse",
        levels,
        height: levels * METERS_PER_LEVEL,
        areaM2: bArea,
        color: buildingColor("mixeduse", levels, nid),
        isNew: true,
        name: "New mixed-use building",
      },
    };
    return {
      type: "replace",
      removeId: p.id,
      features: [f],
      cost: Math.round(demoCost + bArea * levels * COST.buildPerM2Floor),
      label: "Parking lot to mixed use",
    };
  }

  // "behind": building along the street, parking kept in the rear half
  const roads = store.features().filter((f) => f.properties.kind === "road");
  const centroid = turf.centroid(lot as never).geometry.coordinates as [number, number];
  const nr = nearestRoad(centroid, roads, 200);
  if (!nr) return { error: "No street nearby to face the building toward." };
  const split = splitLotByRoad(lot, nr);
  if (!split.front || !split.rear) {
    return { error: "Could not split this lot cleanly. Try replacing it outright." };
  }
  const bFoot = inset(split.front, 2) ?? split.front;
  const bArea = turf.area(bFoot as never);
  if (bArea < 100) return { error: "The street-facing half is too small to build on." };
  const rearArea = turf.area(split.rear as never);
  const levels = 3;
  const bid = store.newId();
  const building: Feature = {
    type: "Feature",
    geometry: bFoot.geometry,
    properties: {
      id: bid,
      kind: "building",
      use: "mixeduse",
      levels,
      height: levels * METERS_PER_LEVEL,
      areaM2: bArea,
      color: buildingColor("mixeduse", levels, bid),
      isNew: true,
      name: "New street-front building",
    },
  };
  const rearLot: Feature = {
    type: "Feature",
    geometry: split.rear.geometry,
    properties: {
      id: store.newId(),
      kind: "parking",
      areaM2: rearArea,
      isNew: true,
      name: "Rear parking",
    },
  };
  return {
    type: "replace",
    removeId: p.id,
    features: [building, rearLot],
    cost: Math.round(demoCost * 0.6 + bArea * levels * COST.buildPerM2Floor),
    label: "Building in front, parking behind",
  };
}

export interface BuildingPreset {
  key: string;
  name: string;
  use: BuildingUse;
  levels: number;
  widthM: number;
  depthM: number;
}

export const BUILDING_PRESETS: BuildingPreset[] = [
  { key: "mixeduse", name: "Mixed-use block", use: "mixeduse", levels: 3, widthM: 32, depthM: 18 },
  { key: "apartment", name: "Apartment building", use: "apartment", levels: 4, widthM: 28, depthM: 20 },
  { key: "rowhouses", name: "Row houses", use: "house", levels: 3, widthM: 36, depthM: 12 },
  { key: "civic", name: "Civic hall", use: "civic", levels: 2, widthM: 26, depthM: 22 },
];

/** Footprint for the build tool's ghost: aligned to the nearest street. */
export function presetFootprint(
  store: Store,
  center: [number, number],
  preset: BuildingPreset,
): { geometry: GeoJSON.Polygon; bearing: number } {
  const roads = store.features().filter((f) => f.properties.kind === "road");
  const nr = nearestRoad(center, roads, 120);
  const bearing = nr ? nr.bearing : 0;
  return { geometry: orientedRect(center, bearing, preset.widthM, preset.depthM), bearing };
}

export function placeBuilding(
  store: Store,
  geometry: GeoJSON.Polygon,
  preset: BuildingPreset,
): EditAction {
  const pid = store.newId();
  const f: Feature = {
    type: "Feature",
    geometry,
    properties: {
      id: pid,
      kind: "building",
      use: preset.use,
      levels: preset.levels,
      height: preset.levels * METERS_PER_LEVEL,
      areaM2: turf.area(turf.feature(geometry) as never),
      color: buildingColor(preset.use, preset.levels, pid),
      isNew: true,
      name: preset.name,
    },
  };
  const cost = Math.round((f.properties.areaM2 ?? 0) * preset.levels * COST.buildPerM2Floor);
  return { type: "add", features: [f], cost, label: `Build ${preset.name.toLowerCase()}` };
}

export function addRoad(store: Store, coords: [number, number][]): EditAction {
  const f: Feature = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {
      id: store.newId(),
      kind: "road",
      roadClass: "residential",
      isNew: true,
      name: "New street",
    },
  };
  const cost = Math.round((lineLengthM(f) / 1000) * COST.roadPerKm);
  return { type: "add", features: [f], cost, label: "New street" };
}

export function addRail(store: Store, coords: [number, number][]): EditAction {
  const existing = store
    .features()
    .filter((f) => f.properties.kind === "rail" && f.properties.isNew).length;
  const lineName = `${String.fromCharCode(65 + (existing % 26))} Line`;
  const lineColor = TRANSIT_COLORS[existing % TRANSIT_COLORS.length];
  const line: Feature = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {
      id: store.newId(),
      kind: "rail",
      railKind: "lightrail",
      isNew: true,
      name: lineName,
      lineName,
      lineColor,
    },
  };
  const stations: Feature[] = [coords[0], coords[coords.length - 1]].map((c, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: c },
    properties: {
      id: store.newId(),
      kind: "station",
      railKind: "lightrail",
      isNew: true,
      name: `${lineName} terminus ${i === 0 ? "A" : "B"}`,
      lineColor,
    },
  }));
  const cost = Math.round(
    (lineLengthM(line) / 1000) * COST.lightRailPerKm + stations.length * COST.station,
  );
  return {
    type: "add",
    features: [line, ...stations],
    cost,
    label: `${lineName} with two termini`,
  };
}

export function addStation(store: Store, at: [number, number]): EditAction | { error: string } {
  const rails = store
    .features()
    .filter((f) => f.properties.kind === "rail" && f.geometry.type === "LineString");
  let best: { pt: [number, number]; dist: number; rail: Feature } | null = null;
  for (const rail of rails) {
    try {
      const snapped = turf.nearestPointOnLine(rail as never, turf.point(at), {
        units: "meters",
      });
      const d = (snapped.properties.dist as number) ?? Infinity;
      if (!best || d < best.dist) {
        best = { pt: snapped.geometry.coordinates as [number, number], dist: d, rail };
      }
    } catch {
      continue;
    }
  }
  if (!best || best.dist > 120) {
    return { error: "Click within about a block of a rail line to place a station." };
  }
  const lineName = best.rail.properties.lineName as string | undefined;
  const f: Feature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: best.pt },
    properties: {
      id: store.newId(),
      kind: "station",
      railKind: "lightrail",
      isNew: true,
      name: lineName ? `${lineName} station` : "New station",
      lineColor: best.rail.properties.lineColor,
    },
  };
  return { type: "add", features: [f], cost: COST.station, label: "New station" };
}
