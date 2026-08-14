// Shared geometry helpers: a flat-earth projection good at city scale,
// a grid spatial index, footprint placement, and lot splitting.
import * as turf from "@turf/turf";
import type { Feature } from "./types";

const R = 6371000;
const DEG = Math.PI / 180;

export interface Proj {
  toXY(lon: number, lat: number): [number, number];
}

export function makeProj(refLat: number): Proj {
  const kx = R * DEG * Math.cos(refLat * DEG);
  const ky = R * DEG;
  return {
    toXY(lon: number, lat: number) {
      return [lon * kx, lat * ky];
    },
  };
}

export class GridIndex<T> {
  private cells = new Map<string, { x: number; y: number; item: T }[]>();
  constructor(private cellM: number) {}

  insert(x: number, y: number, item: T): void {
    const k = `${Math.floor(x / this.cellM)},${Math.floor(y / this.cellM)}`;
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push({ x, y, item });
  }

  /** All entries whose point lies within radius r of (x, y). */
  query(x: number, y: number, r: number): { x: number; y: number; item: T; d2: number }[] {
    const out: { x: number; y: number; item: T; d2: number }[] = [];
    const r2 = r * r;
    const c0x = Math.floor((x - r) / this.cellM);
    const c1x = Math.floor((x + r) / this.cellM);
    const c0y = Math.floor((y - r) / this.cellM);
    const c1y = Math.floor((y + r) / this.cellM);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const arr = this.cells.get(`${cx},${cy}`);
        if (!arr) continue;
        for (const e of arr) {
          const dx = e.x - x;
          const dy = e.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) out.push({ ...e, d2 });
        }
      }
    }
    return out;
  }
}

/** Axis-aligned-to-a-bearing rectangle: center, bearing along "width". */
export function orientedRect(
  center: [number, number],
  bearingDeg: number,
  widthM: number,
  depthM: number,
): GeoJSON.Polygon {
  const c = turf.point(center);
  const hw = widthM / 2;
  const hd = depthM / 2;
  const corner = (a: number, b: number) =>
    turf.destination(
      turf.destination(c, a, bearingDeg, { units: "meters" }),
      b,
      bearingDeg + 90,
      { units: "meters" },
    ).geometry.coordinates as [number, number];
  const p1 = corner(hw, hd);
  const p2 = corner(hw, -hd);
  const p3 = corner(-hw, -hd);
  const p4 = corner(-hw, hd);
  return { type: "Polygon", coordinates: [[p1, p2, p3, p4, p1]] };
}

export interface NearestRoad {
  road: Feature;
  point: [number, number];
  bearing: number; // bearing of the road segment at the nearest point
  distM: number;
}

/** Find the nearest drivable road to a point and the road's local bearing. */
export function nearestRoad(
  pt: [number, number],
  roads: Feature[],
  maxM = 150,
): NearestRoad | null {
  let best: NearestRoad | null = null;
  const p = turf.point(pt);
  for (const road of roads) {
    if (road.geometry.type !== "LineString") continue;
    if (road.properties.roadClass === "path") continue;
    let snapped;
    try {
      snapped = turf.nearestPointOnLine(road as never, p, { units: "meters" });
    } catch {
      continue;
    }
    const d = (snapped.properties.dist as number) ?? Infinity;
    if (d > maxM || (best && d >= best.distM)) continue;
    const coords = road.geometry.coordinates;
    const i = Math.min((snapped.properties.index as number) ?? 0, coords.length - 2);
    const b = turf.bearing(turf.point(coords[i]), turf.point(coords[i + 1]));
    best = {
      road,
      point: snapped.geometry.coordinates as [number, number],
      bearing: b,
      distM: d,
    };
  }
  return best;
}

export interface LotSplit {
  front: GeoJSON.Feature | null;
  rear: GeoJSON.Feature | null;
}

/**
 * Split a lot with a line through its centroid parallel to the nearest road.
 * "front" is the half facing the road, "rear" the half behind.
 */
export function splitLotByRoad(lot: Feature, road: NearestRoad): LotSplit {
  const centroid = turf.centroid(lot as never).geometry.coordinates as [number, number];
  const toRoad = turf.bearing(turf.point(centroid), turf.point(road.point));
  // Rectangle covering everything on the rear side of the centroid line.
  const rearCenter = turf.destination(turf.point(centroid), 1000, toRoad + 180, {
    units: "meters",
  }).geometry.coordinates as [number, number];
  const rearHalf = turf.feature(orientedRect(rearCenter, road.bearing, 4000, 2000));
  let rear: GeoJSON.Feature | null = null;
  let front: GeoJSON.Feature | null = null;
  try {
    rear = turf.intersect(turf.featureCollection([lot, rearHalf] as never)) as GeoJSON.Feature | null;
    front = turf.difference(turf.featureCollection([lot, rearHalf] as never)) as GeoJSON.Feature | null;
  } catch {
    return { front: null, rear: null };
  }
  return { front, rear };
}

/** Inset a polygon inward; null if it collapses. */
export function inset(f: GeoJSON.Feature, meters: number): GeoJSON.Feature | null {
  try {
    const b = turf.buffer(f as never, -meters, { units: "meters" }) as
      | GeoJSON.Feature
      | undefined;
    if (!b || !b.geometry || turf.area(b as never) < 40) return null;
    return b;
  } catch {
    return null;
  }
}

export function lineLengthM(f: GeoJSON.Feature): number {
  try {
    return turf.length(f as never, { units: "kilometers" }) * 1000;
  } catch {
    return 0;
  }
}

export function distM(a: [number, number], b: [number, number]): number {
  return turf.distance(turf.point(a), turf.point(b), { units: "kilometers" }) * 1000;
}
