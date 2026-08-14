// Turn flattened-tag OSM GeoJSON into game features.
import * as turf from "@turf/turf";
import type { Feature, Props, RoadClass, BuildingUse } from "./types";
import { METERS_PER_LEVEL } from "./types";

const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: "motorway",
  motorway_link: "motorway",
  trunk: "motorway",
  trunk_link: "motorway",
  primary: "primary",
  primary_link: "primary",
  secondary: "secondary",
  secondary_link: "secondary",
  tertiary: "tertiary",
  tertiary_link: "tertiary",
  residential: "residential",
  unclassified: "residential",
  living_street: "residential",
  service: "service",
  footway: "path",
  path: "path",
  cycleway: "path",
  pedestrian: "path",
  steps: "path",
  track: "path",
};

const GREEN_LANDUSE = new Set([
  "forest", "grass", "meadow", "recreation_ground", "cemetery",
  "village_green", "orchard", "greenfield",
]);
const GREEN_LEISURE = new Set([
  "park", "garden", "pitch", "playground", "golf_course",
  "nature_reserve", "dog_park", "track",
]);
const POI_AMENITY = new Set([
  "restaurant", "cafe", "fast_food", "bar", "pub", "ice_cream",
  "bank", "pharmacy", "library", "post_office", "cinema", "theatre",
  "marketplace", "community_centre",
]);

function buildingUse(tags: Record<string, unknown>): BuildingUse {
  const b = String(tags.building);
  if (["retail", "commercial", "supermarket", "kiosk"].includes(b)) return "retail";
  if (["apartments", "dormitory", "residential"].includes(b)) return "apartment";
  if (["house", "detached", "semidetached_house", "terrace", "bungalow", "static_caravan"].includes(b)) return "house";
  if (b === "garage" || b === "garages" || b === "carport") return "garage";
  if (b === "office") return "office";
  if (["school", "university", "college", "church", "civic", "government", "public", "hospital", "fire_station", "kindergarten"].includes(b)) return "civic";
  if (b === "mixed_use" || b === "mixed") return "mixeduse";
  return "other";
}

function defaultLevels(use: BuildingUse): number {
  switch (use) {
    case "house": return 2;
    case "retail": return 1;
    case "apartment": return 3;
    case "office": return 3;
    case "civic": return 2;
    case "garage": return 1;
    default: return 1;
  }
}

function isPolygonal(f: Feature): boolean {
  return f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon";
}

function safeArea(f: Feature): number {
  try {
    return turf.area(f as never);
  } catch {
    return 0;
  }
}

/** Convert raw flattened OSM GeoJSON features into categorized game features. */
export function categorize(raw: { features: unknown[] }): Feature[] {
  const out: Feature[] = [];
  let n = 0;
  for (const rf of raw.features as Feature[]) {
    const tags = rf.properties as Record<string, unknown>;
    if (!rf.geometry) continue;
    const id = String(tags.osmid ?? `f${n}`);
    n++;
    const geomType = rf.geometry.type;
    const mk = (props: Omit<Props, "id">): Feature => ({
      type: "Feature",
      geometry: rf.geometry,
      properties: { id, ...props } as Props,
    });

    // Buildings (including structured parking, which reads as a garage building)
    if (tags.building && tags.building !== "no" && isPolygonal(rf)) {
      let use = buildingUse(tags);
      if (tags.amenity === "parking" && tags.parking === "multi-storey") use = "garage";
      let levels = Number(tags["building:levels"]);
      const heightTag = parseFloat(String(tags.height ?? ""));
      if (!Number.isFinite(levels) || levels <= 0) {
        levels = Number.isFinite(heightTag) && heightTag > 0
          ? Math.max(1, Math.round(heightTag / METERS_PER_LEVEL))
          : defaultLevels(use);
      }
      const f = mk({
        kind: "building",
        use,
        levels,
        height: Math.round(levels * METERS_PER_LEVEL * 10) / 10,
        name: tags.name as string | undefined,
      });
      f.properties.areaM2 = safeArea(f);
      out.push(f);
      continue;
    }

    // Surface parking, the antagonist
    if (tags.amenity === "parking" && isPolygonal(rf)) {
      const p = String(tags.parking ?? "surface");
      if (p === "underground") continue;
      if (p === "multi-storey") {
        const f = mk({ kind: "building", use: "garage", levels: 4, height: 4 * METERS_PER_LEVEL, name: tags.name as string | undefined });
        f.properties.areaM2 = safeArea(f);
        out.push(f);
        continue;
      }
      const f = mk({ kind: "parking", name: tags.name as string | undefined });
      f.properties.areaM2 = safeArea(f);
      out.push(f);
      continue;
    }

    // Roads
    if (tags.highway && (geomType === "LineString" || geomType === "MultiLineString")) {
      const rc = ROAD_CLASS[String(tags.highway)];
      if (!rc) continue;
      out.push(mk({ kind: "road", roadClass: rc, name: tags.name as string | undefined }));
      continue;
    }

    // Rail lines
    if (tags.railway && (geomType === "LineString" || geomType === "MultiLineString")) {
      const r = String(tags.railway);
      if (!["rail", "subway", "light_rail", "tram"].includes(r)) continue;
      out.push(mk({
        kind: "rail",
        railKind: r === "light_rail" || r === "tram" ? "lightrail" : "metro",
        name: tags.name as string | undefined,
      }));
      continue;
    }

    // Stations and stops
    if (geomType === "Point") {
      if (tags.railway === "station" || tags.station) {
        out.push(mk({ kind: "station", railKind: "metro", name: tags.name as string | undefined }));
        continue;
      }
      if (tags.highway === "bus_stop" || tags.public_transport === "platform") {
        out.push(mk({ kind: "stop", name: tags.name as string | undefined }));
        continue;
      }
      if (tags.shop || POI_AMENITY.has(String(tags.amenity))) {
        out.push(mk({ kind: "poi", name: tags.name as string | undefined }));
        continue;
      }
      continue;
    }

    // Green space
    if (
      isPolygonal(rf) &&
      (GREEN_LANDUSE.has(String(tags.landuse)) ||
        GREEN_LEISURE.has(String(tags.leisure)) ||
        tags.natural === "wood")
    ) {
      const f = mk({ kind: "green", name: tags.name as string | undefined });
      f.properties.areaM2 = safeArea(f);
      out.push(f);
      continue;
    }

    // Water
    if (tags.natural === "water" || tags.waterway === "riverbank") {
      out.push(mk({ kind: "water", name: tags.name as string | undefined }));
      continue;
    }
    if (tags.waterway && (geomType === "LineString" || geomType === "MultiLineString")) {
      out.push(mk({ kind: "water", name: tags.name as string | undefined }));
      continue;
    }

    // Zoning tints from landuse
    if (isPolygonal(rf) && tags.landuse) {
      const lu = String(tags.landuse);
      const zone =
        lu === "residential" ? "residential" :
        lu === "retail" || lu === "commercial" ? "commercial" :
        lu === "industrial" || lu === "railway" ? "industrial" : null;
      if (zone) {
        out.push(mk({ kind: "zone", zone }));
      }
      continue;
    }
  }
  return out;
}
