import type {
  Feature as GJFeature,
  FeatureCollection as GJFeatureCollection,
  Geometry,
} from "geojson";

export type BuildingUse =
  | "retail"
  | "mixeduse"
  | "apartment"
  | "house"
  | "office"
  | "civic"
  | "garage"
  | "other";

export type RoadClass =
  | "motorway"
  | "primary"
  | "secondary"
  | "tertiary"
  | "residential"
  | "service"
  | "path";

export type Kind =
  | "building"
  | "parking"
  | "road"
  | "rail"
  | "station"
  | "stop"
  | "green"
  | "water"
  | "plaza"
  | "poi"
  | "zone";

export interface Props {
  id: string;
  kind: Kind;
  name?: string;
  use?: BuildingUse;
  levels?: number;
  height?: number;
  roadClass?: RoadClass;
  railKind?: "metro" | "lightrail";
  zone?: "residential" | "commercial" | "industrial";
  isNew?: boolean;
  areaM2?: number;
  streetscape?: "dieted" | "pedestrianized";
  treeLined?: boolean;
  lineColor?: string;
  lineName?: string;
  [key: string]: unknown;
}

export type Feature = GJFeature<Geometry, Props>;
export type FC = GJFeatureCollection<Geometry, Props>;

export type EditAction = (
  | { type: "demolish"; id: string; cost: number; label: string }
  | {
      type: "remodel";
      id: string;
      use: BuildingUse;
      levels: number;
      cost: number;
      label: string;
    }
  | { type: "add"; features: Feature[]; cost: number; label: string }
  | {
      type: "restreet";
      id: string;
      streetscape?: "dieted" | "pedestrianized";
      treeLined?: boolean;
      cost: number;
      label: string;
    }
  | {
      type: "replace";
      removeId: string;
      features: Feature[];
      cost: number;
      label: string;
    }
) & {
  /** Stamped at apply time; sandbox edits never count against a budget. */
  sandbox?: boolean;
};

export interface Scores {
  walk: number;
  transit: number;
  density: number;
  green: number;
  overall: number;
  /** per-road-feature walk score, for the score lens */
  roadWalk: Map<string, number>;
}

// Rough real-world unit costs, tuned for game feel. All dollars.
export const COST = {
  demoBuildingPerM2Floor: 200,
  demoParkingPerM2: 20,
  buildPerM2Floor: 2600,
  remodelFactor: 0.7, // remodel = rebuild at a discount, keeping the footprint
  parkPerM2: 70,
  plazaPerM2: 140,
  roadPerKm: 7_000_000,
  lightRailPerKm: 90_000_000,
  station: 45_000_000,
  treesPerKm: 600_000,
  roadDietPerKm: 2_500_000,
  pedestrianizePerKm: 5_000_000,
};

/** Line colors for new transit lines, assigned in order. */
export const TRANSIT_COLORS = ["#2E6B4F", "#8E3B4A", "#2F6D74", "#A87B2D", "#22303C"];

export const METERS_PER_LEVEL = 3.2;

export function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

export function fmtArea(m2: number): string {
  return `${Math.round(m2).toLocaleString()} m²`;
}
