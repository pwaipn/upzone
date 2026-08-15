// Fetch a bounding box of OSM data via Overpass and save it as GeoJSON.
// Usage: node scripts/fetch-place.mjs <south> <west> <north> <east> <outfile>
import osmtogeojson from "osmtogeojson";
import { writeFileSync } from "node:fs";

const [south, west, north, east, outfile] = process.argv.slice(2);
if (!outfile) {
  console.error("usage: node scripts/fetch-place.mjs S W N E out.geo.json");
  process.exit(1);
}
const bbox = `${south},${west},${north},${east}`;

const query = `
[out:json][timeout:180];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["highway"](${bbox});
  way["amenity"](${bbox});
  relation["amenity"="parking"](${bbox});
  way["landuse"](${bbox});
  relation["landuse"](${bbox});
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
out body;
>;
out skel qt;
`;

console.log("querying overpass…");
const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  body: "data=" + encodeURIComponent(query),
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "upzone/0.1 (personal city-modeling game)",
  },
});
if (!res.ok) {
  console.error("overpass error", res.status, await res.text());
  process.exit(1);
}
const osm = await res.json();
console.log("elements:", osm.elements.length);

const gj = osmtogeojson(osm);

// Trim: round coords to 6 decimals (~10cm) and keep only tags the game reads.
const KEEP = new Set([
  "building", "building:levels", "height", "name", "highway", "amenity",
  "landuse", "leisure", "natural", "waterway", "railway", "shop", "parking",
  "public_transport", "station", "lanes", "surface", "layer", "bridge",
  "tunnel", "service", "access", "oneway",
  "min_height", "building:min_level", "roof:levels",
  "addr:housenumber", "addr:street",
]);
const round = (c) => Math.round(c * 1e6) / 1e6;
const roundCoords = (coords) =>
  typeof coords[0] === "number" ? coords.map(round) : coords.map(roundCoords);

for (const f of gj.features) {
  f.geometry.coordinates = roundCoords(f.geometry.coordinates);
  const props = { osmid: f.id };
  for (const [k, v] of Object.entries(f.properties?.tags ?? f.properties ?? {})) {
    if (KEEP.has(k)) props[k] = v;
  }
  f.properties = props;
}

writeFileSync(outfile, JSON.stringify(gj));
console.log("wrote", outfile, `${gj.features.length} features`);
