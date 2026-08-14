// Live loading: geocode with Nominatim, fetch a clamped bbox from Overpass
// with inline geometry, and convert to the same flattened GeoJSON shape the
// bundled snapshot uses.
import type { Feature } from "./types";

export interface GeocodeResult {
  name: string;
  slug: string;
  lat: number;
  lon: number;
}

export async function geocode(q: string): Promise<GeocodeResult[]> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=" +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = (await res.json()) as {
    display_name: string;
    lat: string;
    lon: string;
    osm_type: string;
    osm_id: number;
  }[];
  // osm_id is only unique per element type, so the slug needs both.
  return data.map((d) => ({
    name: d.display_name.split(",").slice(0, 3).join(","),
    slug: `osm-${d.osm_type}-${d.osm_id}`,
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
  }));
}

const KEEP = new Set([
  "building", "building:levels", "height", "name", "highway", "amenity",
  "landuse", "leisure", "natural", "waterway", "railway", "shop", "parking",
  "public_transport", "station",
]);

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: {
    type: string;
    role: string;
    geometry?: { lat: number; lon: number }[];
  }[];
}

const AREA_TAGS = ["building", "landuse", "leisure", "amenity", "natural"];

function elementToFeatures(el: OverpassElement): Feature[] {
  const tags = el.tags ?? {};
  const props: Record<string, unknown> = { osmid: `${el.type}/${el.id}` };
  for (const [k, v] of Object.entries(tags)) if (KEEP.has(k)) props[k] = v;

  if (el.type === "node") {
    if (el.lat === undefined || el.lon === undefined) return [];
    return [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [el.lon, el.lat] },
        properties: props,
      } as unknown as Feature,
    ];
  }

  if (el.type === "way" && el.geometry && el.geometry.length >= 2) {
    const coords = el.geometry.map((g) => [g.lon, g.lat]);
    const closed =
      coords.length >= 4 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1];
    const wantsArea = AREA_TAGS.some((t) => tags[t]) && !tags.highway;
    const geometry: GeoJSON.Geometry =
      closed && wantsArea
        ? { type: "Polygon", coordinates: [coords] }
        : { type: "LineString", coordinates: coords };
    return [{ type: "Feature", geometry, properties: props } as unknown as Feature];
  }

  if (el.type === "relation" && el.members) {
    // Outer rings only; holes and split rings are skipped, which is close
    // enough for gameplay.
    const out: Feature[] = [];
    let i = 0;
    for (const m of el.members) {
      if (m.role !== "outer" || !m.geometry || m.geometry.length < 4) continue;
      const coords = m.geometry.map((g) => [g.lon, g.lat]);
      if (
        coords[0][0] !== coords[coords.length - 1][0] ||
        coords[0][1] !== coords[coords.length - 1][1]
      ) {
        continue;
      }
      out.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [coords] },
        properties: { ...props, osmid: `${props.osmid}#${i++}` },
      } as unknown as Feature);
    }
    return out;
  }
  return [];
}

/** Fetch a playable area around a point. Clamped to roughly 4 km square. */
export async function fetchArea(
  lat: number,
  lon: number,
  onStatus: (msg: string) => void,
): Promise<{ features: Feature[] }> {
  const dLat = 0.018;
  const dLon = 0.018 / Math.cos((lat * Math.PI) / 180);
  const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`;
  const query = `
[out:json][timeout:90];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["highway"](${bbox});
  way["amenity"](${bbox});
  relation["amenity"="parking"](${bbox});
  way["landuse"](${bbox});
  way["leisure"](${bbox});
  way["natural"~"^(water|wood)$"](${bbox});
  way["waterway"](${bbox});
  way["railway"](${bbox});
  node["railway"](${bbox});
  node["public_transport"](${bbox});
  node["highway"="bus_stop"](${bbox});
  node["shop"](${bbox});
  node["amenity"](${bbox});
);
out geom qt;
`;
  onStatus("Asking OpenStreetMap for the neighborhood…");
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) throw new Error(`Overpass returned ${res.status}. Try again in a minute.`);
  const osm = (await res.json()) as { elements: OverpassElement[] };
  onStatus(`Drafting ${osm.elements.length.toLocaleString()} map elements…`);
  const features: Feature[] = [];
  for (const el of osm.elements) features.push(...elementToFeatures(el));
  return { features };
}
