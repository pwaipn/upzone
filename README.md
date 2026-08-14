# Upzone

A New Urbanist redevelopment game played on real places.

Upzone loads a real district from OpenStreetMap and hands you the tools a
town never gives you: bulldoze the strip mall, put the parking behind the
buildings, draw the light rail line to the Metro station, and watch the
district's report card change as you work. It ships with McLean, Virginia
preloaded, and can survey any place OpenStreetMap knows about.

## The idea

McLean has a Metro station named after it that is two miles from its own
downtown, with a sea of street-facing parking in between. This game exists to
fix that, block by block, and to grade the result on the New Urbanist basics:

- **Walkability** — destinations within a quarter-mile walk, and streets
  fronted by buildings instead of asphalt
- **Transit** — how much of the district is within a comfortable walk of rail
- **Density** — built intensity, measured as a rough floor-area ratio
- **Green vs. asphalt** — parks winning or losing against surface parking

Scores are computed per street segment (no simulated pedestrians, just the
geometry of the place) and rolled up into a district grade, stamped on the
plan like a review that actually passed.

## Modes

- **Charrette mode** — the free sandbox. Everything costs nothing.
- **Project mode** — a budget and a checklist. The first scenario is
  *The McLean Connector*: link downtown McLean to McLean Metro by rail,
  raise the transit score to 60, and cut surface parking by a fifth,
  all inside $900M.

## Running it

```
npm install
npm run dev
```

To refresh or refetch the bundled McLean snapshot:

```
node scripts/fetch-place.mjs 38.912 -77.232 38.948 -77.155 public/data/mclean.geo.json
```

## Stack

Vite + TypeScript, MapLibre GL for the 2.5D plan-sheet rendering, Turf for
the geometry, OpenStreetMap via Overpass for the world and Nominatim for the
search box. Map data © OpenStreetMap contributors.
