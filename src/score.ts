// Segment-level scoring: no simulated pedestrians, just the geometry of the
// place graded street by street, then rolled up to a district report card.
import * as turf from "@turf/turf";
import type { Feature, Scores } from "./types";
import { GridIndex, makeProj } from "./geometry";

interface AreaEntry {
  area: number;
}
interface VolEntry {
  vol: number;
  area: number;
}

const WALKABLE = new Set(["primary", "secondary", "tertiary", "residential"]);

export function computeScores(features: Feature[], refLat: number): Scores {
  const proj = makeProj(refLat);

  const pois = new GridIndex<true>(200);
  const stations = new GridIndex<true>(400);
  const stops = new GridIndex<true>(200);
  const buildings = new GridIndex<VolEntry>(150);
  const parking = new GridIndex<AreaEntry>(150);
  const parks = new GridIndex<AreaEntry>(250);

  let totalParkM2 = 0;
  let totalParkingM2 = 0;
  const roadSamples: { id: string; x: number; y: number }[] = [];

  for (const f of features) {
    const p = f.properties;
    try {
      switch (p.kind) {
        case "poi": {
          const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
          const [x, y] = proj.toXY(lon, lat);
          pois.insert(x, y, true);
          break;
        }
        case "station": {
          const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
          const [x, y] = proj.toXY(lon, lat);
          stations.insert(x, y, true);
          break;
        }
        case "stop": {
          const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
          const [x, y] = proj.toXY(lon, lat);
          stops.insert(x, y, true);
          break;
        }
        case "building": {
          const c = turf.centroid(f as never).geometry.coordinates;
          const [x, y] = proj.toXY(c[0], c[1]);
          const area = p.areaM2 ?? 0;
          buildings.insert(x, y, { vol: area * (p.levels ?? 1), area });
          // Ground-floor retail and mixed use count as walkable destinations too.
          if (p.use === "retail" || p.use === "mixeduse") pois.insert(x, y, true);
          break;
        }
        case "parking": {
          const c = turf.centroid(f as never).geometry.coordinates;
          const [x, y] = proj.toXY(c[0], c[1]);
          const area = p.areaM2 ?? 0;
          parking.insert(x, y, { area });
          totalParkingM2 += area;
          break;
        }
        case "green":
        case "plaza": {
          const c = turf.centroid(f as never).geometry.coordinates;
          const [x, y] = proj.toXY(c[0], c[1]);
          const area = p.areaM2 ?? 0;
          parks.insert(x, y, { area });
          totalParkM2 += area;
          break;
        }
        case "road": {
          if (f.geometry.type !== "LineString") break;
          if (!WALKABLE.has(p.roadClass ?? "")) break;
          const coords = f.geometry.coordinates;
          const mid = coords[Math.floor(coords.length / 2)];
          const [x, y] = proj.toXY(mid[0], mid[1]);
          roadSamples.push({ id: p.id, x, y });
          break;
        }
      }
    } catch {
      // skip malformed features
    }
  }

  const roadWalk = new Map<string, number>();
  let walkSum = 0;
  let transitSum = 0;
  let densitySum = 0;
  let parkAccessSum = 0;

  for (const s of roadSamples) {
    // Destinations within a 400 m walk
    const nPois = pois.query(s.x, s.y, 400).length;
    const amenity = Math.min(1, nPois / 8);

    // Street frontage: buildings versus asphalt within 60 m
    let bNear = 0;
    for (const e of buildings.query(s.x, s.y, 60)) bNear += e.item.area;
    let pNear = 0;
    for (const e of parking.query(s.x, s.y, 60)) pNear += e.item.area;
    const frontage = bNear + pNear > 0 ? bNear / (bNear + 1.6 * pNear) : 0.35;

    const walk = 0.55 * amenity + 0.45 * frontage;
    roadWalk.set(s.id, walk);
    walkSum += walk;

    // Rail within a comfortable walk, bus as a bonus
    let dStation = Infinity;
    for (const e of stations.query(s.x, s.y, 900)) {
      if (e.d2 < dStation) dStation = e.d2;
    }
    dStation = Math.sqrt(dStation);
    let transit =
      dStation <= 400 ? 1 : dStation <= 900 ? 1 - ((dStation - 400) / 500) * 0.65 : 0;
    if (stops.query(s.x, s.y, 250).length > 0) transit = Math.min(1, transit + 0.25);
    transitSum += transit;

    // Built intensity within 300 m, expressed as a rough FAR
    let vol = 0;
    for (const e of buildings.query(s.x, s.y, 300)) vol += e.item.vol;
    const far = vol / (Math.PI * 300 * 300);
    densitySum += Math.min(1, far / 0.75);

    parkAccessSum += parks.query(s.x, s.y, 500).length > 0 ? 1 : 0;
  }

  const n = Math.max(1, roadSamples.length);
  const walk = walkSum / n;
  const transit = transitSum / n;
  const density = densitySum / n;
  const coverage =
    totalParkM2 + totalParkingM2 > 0
      ? totalParkM2 / (totalParkM2 + totalParkingM2)
      : 0.5;
  const green = 0.5 * coverage + 0.5 * (parkAccessSum / n);

  const overall = 0.35 * walk + 0.25 * transit + 0.2 * density + 0.2 * green;

  return {
    walk: Math.round(walk * 100),
    transit: Math.round(transit * 100),
    density: Math.round(density * 100),
    green: Math.round(green * 100),
    overall: Math.round(overall * 100),
    roadWalk,
  };
}

export function grade(overall: number): string {
  if (overall >= 85) return "A";
  if (overall >= 70) return "B";
  if (overall >= 55) return "C";
  if (overall >= 40) return "D";
  return "F";
}
