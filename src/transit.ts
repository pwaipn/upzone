// Transit modeled as numbers, not people: each station's walkshed is summed
// from real floor area, and ridership is estimated from residents and jobs
// within a comfortable walk. Rough coefficients, tuned for plausibility:
// ~95 m² of residential floor per home, 2.3 people per home, ~28 m² of
// commercial floor per job, and transit propensities in the range US rail
// stations actually see for walkable catchments.
import * as turf from "@turf/turf";
import type { Feature } from "./types";
import { makeProj } from "./geometry";

const WALKSHED_M = 800;

export interface StationStats {
  residents: number;
  jobs: number;
  homes: number;
  boardings: number;
}

export function floorAreas(f: Feature): { res: number; com: number } {
  const p = f.properties;
  if (p.kind !== "building") return { res: 0, com: 0 };
  const floor = (p.areaM2 ?? 0) * (p.levels ?? 1);
  switch (p.use) {
    case "house":
    case "apartment":
      return { res: floor, com: 0 };
    case "retail":
      return { res: 0, com: floor };
    case "office":
      return { res: 0, com: floor };
    case "civic":
      return { res: 0, com: floor * 0.5 };
    case "mixeduse": {
      const ground = p.areaM2 ?? 0;
      return { res: Math.max(0, floor - ground), com: ground };
    }
    default:
      return { res: 0, com: 0 };
  }
}

export function stationStats(
  features: Feature[],
  station: Feature,
  refLat: number,
): StationStats {
  const proj = makeProj(refLat);
  const sc = (station.geometry as GeoJSON.Point).coordinates;
  const [sx, sy] = proj.toXY(sc[0], sc[1]);
  let res = 0;
  let com = 0;
  for (const f of features) {
    if (f.properties.kind !== "building") continue;
    let c: number[];
    try {
      c = turf.centroid(f as never).geometry.coordinates;
    } catch {
      continue;
    }
    const [x, y] = proj.toXY(c[0], c[1]);
    const dx = x - sx;
    const dy = y - sy;
    if (dx * dx + dy * dy > WALKSHED_M * WALKSHED_M) continue;
    const fa = floorAreas(f);
    res += fa.res;
    com += fa.com;
  }
  const homes = res / 95;
  const residents = homes * 2.3;
  const jobs = com / 28;
  const boardings = 0.26 * residents + 0.22 * jobs;
  return {
    homes: Math.round(homes),
    residents: Math.round(residents),
    jobs: Math.round(jobs),
    boardings: Math.round(boardings),
  };
}

export interface LineStats {
  lengthKm: number;
  stations: Feature[];
  boardings: number;
}

export function lineStats(
  features: Feature[],
  line: Feature,
  refLat: number,
): LineStats {
  let lengthKm = 0;
  try {
    lengthKm = turf.length(line as never, { units: "kilometers" });
  } catch {
    // degenerate line
  }
  const stations = features.filter((f) => {
    if (f.properties.kind !== "station" || f.geometry.type !== "Point") return false;
    try {
      const snapped = turf.nearestPointOnLine(line as never, f as never, {
        units: "meters",
      });
      return ((snapped.properties.dist as number) ?? Infinity) < 60;
    } catch {
      return false;
    }
  });
  let boardings = 0;
  for (const s of stations) boardings += stationStats(features, s, refLat).boardings;
  return { lengthKm, stations, boardings };
}
