// Project mode: a budget and a checklist. The first scenario is the one this
// game was built for: tie downtown McLean to its own Metro station.
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
    const railLengthKm =
      features
        .filter((f) => f.properties.kind === "rail" && f.properties.isNew)
        .reduce((sum, f) => {
          if (f.geometry.type !== "LineString") return sum;
          let m = 0;
          const c = f.geometry.coordinates as [number, number][];
          for (let i = 1; i < c.length; i++) m += distM(c[i - 1], c[i]);
          return sum + m;
        }, 0) / 1000;

    const stationCoord = (f: Feature): [number, number] =>
      (f.geometry as GeoJSON.Point).coordinates as [number, number];
    const nearDowntown = newStations.some(
      (f) => distM(stationCoord(f), DOWNTOWN_MCLEAN) < 500,
    );
    const nearMetro =
      metro !== null && newStations.some((f) => distM(stationCoord(f), metro) < 400);
    const linked = nearDowntown && nearMetro && railLengthKm >= 2.5;

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
            ? "Downtown has a station. Now reach the Metro."
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
