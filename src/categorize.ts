// Turn flattened-tag OSM GeoJSON into game features.
import * as turf from "@turf/turf";
import type { Feature, Props, RoadClass, BuildingUse } from "./types";
import { METERS_PER_LEVEL } from "./types";
import { THEME } from "./theme";

/** Shade a hex color: f < 1 darkens, f > 1 lightens. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const scaled = f <= 1 ? v * f : v + (255 - v) * (f - 1);
    return Math.max(0, Math.min(255, Math.round(scaled)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Deterministic small jitter from the feature id, so blocks vary. */
function jitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 0.96 + (Math.abs(h) % 9) / 100; // 0.96 … 1.04
}

/** Precomputed facade color: use color, deepened with height, jittered. */
export function buildingColor(use: BuildingUse, levels: number, id: string): string {
  const base = THEME.building[use] ?? THEME.building.other;
  const heightF = 1 - Math.min(0.14, Math.max(0, levels - 1) * 0.018);
  return shade(base, heightF * jitter(id));
}

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
  if (b === "garage" || b === "garages" || b === "carport" || b === "parking") return "garage";
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
      // building=parking is a structured garage, not a residential one; give
      // it a garage's height rather than a carport's.
      const structuredParking =
        String(tags.building) === "parking" ||
        (tags.amenity === "parking" && tags.parking === "multi-storey");
      if (structuredParking) use = "garage";
      let levels = Number(tags["building:levels"]);
      const heightTag = parseFloat(String(tags.height ?? ""));
      if (!Number.isFinite(levels) || levels <= 0) {
        levels = Number.isFinite(heightTag) && heightTag > 0
          ? Math.max(1, Math.round(heightTag / METERS_PER_LEVEL))
          : structuredParking
            ? 4
            : defaultLevels(use);
      }
      // Elevated parts (skywalks, buildings over plazas) start above ground
      const minH = parseFloat(String(tags.min_height ?? ""));
      const minLv = Number(tags["building:min_level"]);
      const base =
        Number.isFinite(minH) && minH > 0
          ? minH
          : Number.isFinite(minLv) && minLv > 0
            ? minLv * METERS_PER_LEVEL
            : 0;
      const heightM =
        Number.isFinite(heightTag) && heightTag > 0
          ? heightTag
          : Math.round(levels * METERS_PER_LEVEL * 10) / 10;
      const addr =
        tags["addr:housenumber"] && tags["addr:street"]
          ? `${tags["addr:housenumber"]} ${tags["addr:street"]}`
          : undefined;
      const f = mk({
        kind: "building",
        use,
        levels,
        height: Math.max(heightM, base + METERS_PER_LEVEL),
        base: base || undefined,
        addr,
        inside: (tags.shop ?? (POI_AMENITY.has(String(tags.amenity)) ? tags.amenity : undefined)) as
          | string
          | undefined,
        name: tags.name as string | undefined,
      });
      f.properties.areaM2 = safeArea(f);
      f.properties.color = buildingColor(use, levels, id);
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

    // Roads (street-running trams are tagged highway + railway on one way;
    // emit both so the rail is not lost)
    if (tags.highway && (geomType === "LineString" || geomType === "MultiLineString")) {
      const rc = ROAD_CLASS[String(tags.highway)];
      if (rc) {
        out.push(mk({ kind: "road", roadClass: rc, name: tags.name as string | undefined }));
      }
      const r = String(tags.railway ?? "");
      if (["rail", "subway", "light_rail", "tram"].includes(r)) {
        out.push({
          type: "Feature",
          geometry: rf.geometry,
          properties: {
            id: `${id}-rail`,
            kind: "rail",
            railKind: r === "light_rail" || r === "tram" ? "lightrail" : "metro",
            name: tags.name as string | undefined,
          } as Props,
        });
      }
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
      if (
        tags.railway === "station" ||
        tags.railway === "halt" ||
        tags.railway === "tram_stop" ||
        tags.station
      ) {
        const light =
          tags.railway === "tram_stop" ||
          tags.station === "light_rail" ||
          tags.station === "tram";
        out.push(mk({
          kind: "station",
          railKind: light ? "lightrail" : "metro",
          name: tags.name as string | undefined,
        }));
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

  inferUnknownUses(out);
  return out;
}

/**
 * Zoning-aware inference: a building tagged only building=yes takes its use
 * from the landuse zone it stands in, sized by footprint and floors.
 */
function inferUnknownUses(features: Feature[]): void {
  const zones = features.filter((f) => f.properties.kind === "zone");
  if (!zones.length) return;
  const zoneBBoxes = zones.map((z) => {
    try {
      return turf.bbox(z as never);
    } catch {
      return null;
    }
  });
  for (const f of features) {
    const p = f.properties;
    if (p.kind !== "building" || p.use !== "other") continue;
    let c: number[];
    try {
      c = turf.centroid(f as never).geometry.coordinates;
    } catch {
      continue;
    }
    for (let i = 0; i < zones.length; i++) {
      const bb = zoneBBoxes[i];
      if (!bb || c[0] < bb[0] || c[0] > bb[2] || c[1] < bb[1] || c[1] > bb[3]) continue;
      let inside = false;
      try {
        inside = turf.booleanPointInPolygon(turf.point(c), zones[i] as never);
      } catch {
        continue;
      }
      if (!inside) continue;
      const zone = zones[i].properties.zone;
      const levels = p.levels ?? 1;
      const area = p.areaM2 ?? 0;
      if (zone === "commercial") {
        p.use = levels >= 3 ? "office" : "retail";
      } else if (zone === "residential") {
        p.use = area < 350 && levels <= 2 ? "house" : "apartment";
      } else if (zone === "industrial") {
        p.use = "other";
      }
      p.color = buildingColor(p.use ?? "other", levels, p.id);
      break;
    }
  }
}
