// The context drawing: OpenFreeMap planet tiles restyled to the plan sheet,
// so the whole DMV (and the rest of the world) reads as one faint drawing
// beneath the surveyed district. Flat fills only; the surveyed area is the
// only thing that stands up.
import type { Map as MLMap } from "maplibre-gl";
import { THEME } from "./theme";

export function addBasemap(m: MLMap): void {
  m.addSource("ofm", {
    type: "vector",
    url: "https://tiles.openfreemap.org/planet",
  });

  const before = undefined; // appended in order, before game layers are added

  m.addLayer(
    {
      id: "ctx-landcover", type: "fill", source: "ofm", "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["grass", "wood", "farmland", "wetland"]]],
      paint: { "fill-color": THEME.parkFill, "fill-opacity": 0.32 },
    },
    before,
  );
  m.addLayer(
    {
      id: "ctx-landuse-green", type: "fill", source: "ofm", "source-layer": "landuse",
      filter: ["in", ["get", "class"], ["literal", ["cemetery", "stadium", "pitch", "track", "theme_park", "zoo"]]],
      paint: { "fill-color": THEME.parkFill, "fill-opacity": 0.25 },
    },
    before,
  );
  m.addLayer(
    {
      id: "ctx-residential", type: "fill", source: "ofm", "source-layer": "landuse",
      filter: ["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood"]]],
      paint: { "fill-color": THEME.zone.residential, "fill-opacity": 0.18 },
    },
    before,
  );
  m.addLayer(
    {
      id: "ctx-water", type: "fill", source: "ofm", "source-layer": "water",
      paint: { "fill-color": THEME.water, "fill-opacity": 0.75 },
    },
    before,
  );
  m.addLayer(
    {
      id: "ctx-buildings", type: "fill", source: "ofm", "source-layer": "building",
      minzoom: 12,
      paint: { "fill-color": "#D8D6CC", "fill-opacity": 0.75 },
    },
    before,
  );
  m.addLayer(
    {
      id: "ctx-rail", type: "line", source: "ofm", "source-layer": "transportation",
      filter: ["==", ["get", "class"], "rail"],
      paint: {
        "line-color": THEME.ink,
        "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 0.5, 14, 1.6],
        "line-opacity": 0.35,
        "line-dasharray": [4, 2],
      },
    },
    before,
  );
  m.addLayer(
    {
      id: "ctx-roads", type: "line", source: "ofm", "source-layer": "transportation",
      filter: [
        "in", ["get", "class"],
        ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "class"],
          "motorway", THEME.road.motorway,
          "trunk", THEME.road.motorway,
          "primary", THEME.road.primary,
          "secondary", THEME.road.secondary,
          "tertiary", THEME.road.tertiary,
          THEME.road.residential],
        "line-width": ["interpolate", ["exponential", 1.5], ["zoom"],
          6, ["match", ["get", "class"], "motorway", 1.2, "trunk", 1, 0.3],
          12, ["match", ["get", "class"], "motorway", 4, "trunk", 3.2, "primary", 2.4, "secondary", 1.8, 1],
          16, ["match", ["get", "class"], "motorway", 16, "trunk", 13, "primary", 10, "secondary", 8, "tertiary", 6.5, 5]],
        "line-opacity": 0.8,
      },
    },
    before,
  );
}
