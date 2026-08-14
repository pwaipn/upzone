// Project mode: a budget and a checklist. The first scenario is the one this
// game was built for: tie downtown McLean to its own Metro station.
import * as turf from "@turf/turf";
import type { Feature, Scores } from "./types";
import type { Store } from "./state";
import { distM } from "./geometry";

export interface GoalResult {
  text: string;
  done: boolean;
  detail?: string;
}

export interface Scenario {
  slug: string;
  name: string;
  budget: number;
  brief: string;
  evaluate(store: Store, scores: Scores): GoalResult[];
}

function findStation(features: Feature[], name: string): [number, number] | null {
  for (const f of features) {
    if (
      f.properties.kind === "station" &&
      !f.properties.isNew &&
      f.properties.name === name &&
      f.geometry.type === "Point"
    ) {
      return f.geometry.coordinates as [number, number];
    }
  }
  return null;
}

const DOWNTOWN_MCLEAN: [number, number] = [-77.1773, 38.9339];

export const MCLEAN_CONNECTOR: Scenario = {
  slug: "mclean",
  name: "The McLean Connector",
  budget: 900_000_000,
  brief:
    "Downtown McLean sits two miles from the Metro station that carries its name, with no rail between them. Build the connection, then fix what the asphalt did to the streets.",
  evaluate(store, scores) {
    const features = store.features();
    const metro = findStation(features, "McLean");
    const newStations = features.filter(
      (f) => f.properties.kind === "station" && f.properties.isNew && f.geometry.type === "Point",
    );
    const newRail = features.filter(
      (f) => f.properties.kind === "rail" && f.properties.isNew && f.geometry.type === "LineString",
    );
    const lineCoords = newRail.map(
      (f) => (f.geometry as GeoJSON.LineString).coordinates as [number, number][],
    );

    // Group the new track into connected components (lines whose vertices
    // come within a station-platform's length of each other), so two
    // disconnected stubs cannot satisfy the link.
    const parent = lineCoords.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const touches = (a: [number, number][], b: [number, number][]) =>
      a.some((pa) => b.some((pb) => distM(pa, pb) < 60));
    for (let i = 0; i < lineCoords.length; i++) {
      for (let j = i + 1; j < lineCoords.length; j++) {
        if (find(i) !== find(j) && touches(lineCoords[i], lineCoords[j])) {
          parent[find(j)] = find(i);
        }
      }
    }
    const lineLenM = (c: [number, number][]) => {
      let m = 0;
      for (let i = 1; i < c.length; i++) m += distM(c[i - 1], c[i]);
      return m;
    };
    const stationCoord = (f: Feature): [number, number] =>
      (f.geometry as GeoJSON.Point).coordinates as [number, number];
    const onLine = (s: [number, number], line: Feature) => {
      try {
        const snapped = turf.nearestPointOnLine(line as never, turf.point(s), {
          units: "meters",
        });
        return ((snapped.properties.dist as number) ?? Infinity) < 40;
      } catch {
        return false;
      }
    };

    const railLengthKm = lineCoords.reduce((sum, c) => sum + lineLenM(c), 0) / 1000;
    let linked = false;
    const roots = new Set(lineCoords.map((_, i) => find(i)));
    for (const root of roots) {
      const memberIdx = lineCoords.map((_, i) => i).filter((i) => find(i) === root);
      const lenKm = memberIdx.reduce((s, i) => s + lineLenM(lineCoords[i]), 0) / 1000;
      if (lenKm < 2.5) continue;
      const componentStations = newStations.filter((f) =>
        memberIdx.some((i) => onLine(stationCoord(f), newRail[i])),
      );
      const hasDowntown = componentStations.some(
        (f) => distM(stationCoord(f), DOWNTOWN_MCLEAN) < 500,
      );
      const hasMetro =
        metro !== null &&
        componentStations.some((f) => distM(stationCoord(f), metro) < 400);
      if (hasDowntown && hasMetro) {
        linked = true;
        break;
      }
    }
    const nearDowntown = newStations.some(
      (f) => distM(stationCoord(f), DOWNTOWN_MCLEAN) < 500,
    );

    const parkingNow = features
      .filter((f) => f.properties.kind === "parking")
      .reduce((s, f) => s + (f.properties.areaM2 ?? 0), 0);
    const parkingCut =
      store.baselineParkingM2 > 0 ? 1 - parkingNow / store.baselineParkingM2 : 0;

    return [
      {
        text: "Rail link from downtown McLean to McLean Metro",
        done: linked,
        detail: linked
          ? `${railLengthKm.toFixed(1)} km of new light rail in service`
          : nearDowntown
            ? "Downtown has its station, but the line does not reach the Metro yet."
            : "Draw a light rail line with stations near both anchors.",
      },
      {
        text: "District transit score of 60 or better",
        done: scores.transit >= 60,
        detail: `Currently ${scores.transit}`,
      },
      {
        text: "Cut surface parking by one fifth",
        done: parkingCut >= 0.2,
        detail: `${Math.max(0, Math.round(parkingCut * 100))}% removed so far`,
      },
    ];
  },
};

export function scenarioFor(slug: string): Scenario | null {
  return slug === "mclean" ? MCLEAN_CONNECTOR : null;
}
