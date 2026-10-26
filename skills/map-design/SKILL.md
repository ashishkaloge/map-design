---
name: map-design
description: Make real, accurate maps as one self-contained HTML, SVG and PNG. Choropleths by country, state, province or US county, or by any boundaries in the user's own GeoJSON, TopoJSON or KML (districts, ZIP codes, wards, constituencies, sales territories); bubble, spike and point maps; routes, voyages and GPS tracks from GPX; flow maps; locator maps with an inset globe; and OpenStreetMap city posters. Use whenever the user asks for a map, a "where is" graphic, data by country/state/county/region/district, a trip, flight, run or ride, a city poster, or any geographic visualization. Ships Natural Earth, US Census and OurAirports data, so coastlines, borders and coordinates are real rather than drawn from memory.
license: MIT
metadata:
  version: "0.1"
---

# Map Design

You cannot draw a coastline from memory, and neither can any model. This skill
gives you real geography: bundled boundary data, an offline gazetteer, proper
projections, and a renderer with an editorial design system. You write a short
JSON spec; the CLI draws the map.

**Never hand-write map geometry, SVG paths or coordinates for countries,
coasts or borders.** Always go through `scripts/map.mjs`.

`<skill-dir>` below is this skill's base directory. The CLI needs Node.js 20+
and nothing else. PNG export uses a local Chrome, Edge, Brave or Chromium if
one exists; HTML and SVG always work.

## Workflow

1. **Pick the kind** from the table below. If the request is ambiguous, choose
   the closest kind and state the choice; ask only when the data is missing.
2. **Get the data.** Use the user's file as is (CSV, JSON, GeoJSON, TopoJSON,
   GPX or KML; path relative to the spec). For public statistics, fetch from a
   primary source and record it in `source`. Never invent values. If you must
   show placeholder numbers, say so in `subtitle` or `note`. Areas the skill
   does not bundle (districts, ZIP codes, wards) need a boundary file: see
   [Your own geometry](#your-own-geometry).
3. **Write the spec** as `<name>.json` where the outputs should go. Start from
   the matching example in [references/spec.md](references/spec.md).
4. **Run** `node <skill-dir>/scripts/map.mjs render <name>.json`.
   It writes `<name>.html`, `<name>.svg` and `<name>.png` next to the spec and
   prints what it matched.
5. **Read the report.** Fix every `NOT MATCHED` row (use the suggestions, an
   ISO code, or `lon`/`lat`) and every ambiguity warning, then render again.
   `node <skill-dir>/scripts/map.mjs check <name>.json` validates without writing.
6. **Look at the PNG** before you call it done. Check that the title states the
   point, labels are legible, nothing important is cut off, and the legend
   matches the data. Adjust and re-render; one or two passes is normal.
7. **Deliver** the file paths, the data source, and anything left unmatched.

## Choosing a kind

| The user has or wants | kind | Notes |
| --- | --- | --- |
| A rate or share per country, state, province or county | `choropleth` | Rates, not raw counts. |
| A rate per district, ZIP code, ward or territory | `choropleth` + `boundaries` | The user's GeoJSON, TopoJSON or KML. |
| Counts or totals at places | `bubbles` | Circle area ∝ value. |
| Many values at points, dense areas | `spikes` | Height ∝ value; good for population. |
| Locations, optionally by category | `points` | Stores, offices, sightings. |
| An ordered trip, voyage or itinerary | `route` | `mode: "flight"` uses airport codes. |
| A recorded run, ride, hike or drive | `route` + `track` | GPX, KML or GeoJSON line, drawn as recorded. |
| Movement between places with volume | `flows` | Migration, trade, flights. |
| "Where is X?" | `locator` | Highlight a country, region or place, with an inset globe. |
| A city or neighborhood as art | `poster` | Streets from OpenStreetMap; needs network. |

Raw counts on a choropleth mostly show which areas are large. Divide by
population or area, or switch to `bubbles`. The CLI warns when a value column
looks like a count.

## Spec essentials

```json
{
  "kind": "choropleth",
  "title": "Where people are packed in",
  "subtitle": "People per square kilometre, by country",
  "data": "builtin:countries",
  "join": "iso3",
  "value": "density",
  "scale": { "type": "threshold", "breaks": [10, 25, 50, 100, 250], "palette": "purple" },
  "legend": { "title": "People per km²" },
  "source": "Natural Earth (2019 estimates)"
}
```

This one runs as is: `builtin:countries` is bundled.

- `region`: `"world"` (default; Antarctica cropped unless `"antarctica": true`),
  `"usa"`, a continent or area (`"europe"`, `"africa"`, `"south asia"`, …), one
  country (`"IND"`, `"Brazil"`), a list of countries, `[west, south, east, north]`,
  or `"auto"` to frame the data.
- Locations in rows: `lon`/`lat`, `iata`, `place` (+ optional `country`),
  `country`, US `state`, or `admin1` + `country`. Gazetteer place names cover
  about 7,300 cities and towns; anything smaller needs `lon`/`lat`.
- `theme`: `paper` (default), `atlas`, `ink`, `antique`, `swiss`, `blueprint`.
  Posters: `noir`, `paper`, `blueprint`, `sumi`, `terracotta`, `azulejo`,
  `neon`, `forest`, `mono`.
- `size`: `landscape`, `wide`, `square`, `portrait`, `story`, `poster`, or
  `{ "width": W, "height": H }`. Default: chosen from the region's shape.
- `annotations`: `[{ "at": "Lagos", "text": "Africa's largest city\n15.4 million", "dx": 60, "dy": -40 }]`.

Everything else, per kind: [references/spec.md](references/spec.md).

## Your own geometry

Pass the user's file; never redraw or retype its coordinates.

```json
{ "kind": "choropleth", "boundaries": "wards.geojson", "data": "turnout.csv",
  "join": "ward_code", "value": "turnout", "format": { "suffix": "%" } }
```

- **Areas:** `"boundaries"` takes GeoJSON, TopoJSON or KML. Rows join to areas by
  matching a data column to a feature property; codes ignore case and leading
  zeros (`06037` = `6037`). Leave `join` out and the CLI tries every column and
  property pair and reports which matched. Ambiguous matches need explicit keys:
  `"join": "<data column>"`, `"boundaries": { "file", "id": "<property>", "name": "<property>" }`.
  Areas without a row remain in the frame and draw in the no-data color; rows
  without an area are listed.
- **One file with values:** `"data": "districts.geojson"` with no `boundaries`
  shades each polygon by its own property. Set `value`: the CLI will not guess
  between numeric columns, and never picks ids or shape sizes.
- **Points:** `data` may be GeoJSON, GPX waypoints or KML placemarks; each
  feature's point (or an area's centroid) is its location.
- **Tracks:** `{ "kind": "route", "track": "ride.gpx" }` draws a GPS track as
  recorded, marks its waypoints, and reports its length. `routes: [{ "track" }]`
  compares several.
- **Locator:** `"highlight": "site.geojson"` (or `{ "file", "label" }`) highlights
  the file's areas and marks gazetteer cities inside them.

Maps of a small area (a city's wards, a run) frame tightly and leave out the
1:50m country outlines, which would not line up; add `"basemap": "streets"` for
streets and water underneath. Detail is thinned to what the page can show, so
big files draw small. Coordinates must be longitude/latitude (WGS 84); a file
in a projected system (UTM, British National Grid, Web Mercator metres) stops
with a conversion command. Shapefiles and KMZ need converting or unzipping
first, and the error says how. Polygon winding order does not matter.

No file? For districts and other second-level areas, look for the national
statistics or mapping office's boundaries, or geoBoundaries
(<https://www.geoboundaries.org>, open licenses per country). Download the
GeoJSON next to the spec and credit it in `source`. Details:
[references/data.md](references/data.md#your-own-boundaries).

## Basemaps (street-level detail)

The bundled Natural Earth geography is designed for country-scale maps. For streets
under the data, add a basemap. Prefer `"streets"`: vector roads, water, parks and
buildings coloured by the map's theme, sharp at any size, in any projection, with
street and park names on hover in the HTML. No key needed.

```json
{ "kind": "points", "basemap": "streets", "theme": "ink",
  "region": { "center": [12.55, 55.68], "radiusKm": 6 } }
```

Raster presets embed tile images instead: `osm`, `osm-hot`, `light` and `dark` are
keyless; `voyager` and the `carto-*` presets need a provider key in a custom URL.
They force Mercator. The default budget is 144 distinct tiles; `maxTiles` applies to
both kinds. `check` validates configuration without fetching tiles or writing
caches. Keep the generated attribution and copyright links visible.

Before choosing a provider, read [basemap options and provider terms](references/basemaps.md).
OSM, OSM France and CARTO have different access, cache and export requirements;
self-contained output does not grant permission for every use. Use your own tile
service or a provider permitting your workload for bulk or offline map products.

## Design rules

- The title states the finding; the subtitle says what is measured, where and when.
- Always set `source`. Add `note` for caveats (estimates, missing data, borders).
- 4–6 classes for choropleths. Use `quantile` for even groups, `threshold` with
  round breaks when the numbers mean something to readers, `jenks` for clusters.
- Sequential palettes for magnitude; diverging (`red-blue`, `brown-teal`, …) only
  with a meaningful midpoint, set via `scale.center`.
- Do not add Mercator to world maps; the defaults (Equal Earth, conic, azimuthal
  equal-area, Albers USA) already preserve area. Use `"projection": "globe"`
  for an orthographic view.
- Label sparingly: the top values, the places the story is about. The renderer
  drops overlapping labels and lists them in the report.
- Pick the theme for the audience: `paper` or `swiss` for reports, `ink` for
  slides and dark UIs, `atlas` for reference, `antique` for history.

More guidance with examples: [references/cartography.md](references/cartography.md).

## Data you can use without fetching anything

- `"data": "builtin:countries"` gives `iso3`, `name`, `continent`, `region`,
  `population`, `gdpMillionsUsd`, `gdpPerCapita`, `areaKm2`, `density` and
  `income` for every country (Natural Earth, 2019 estimates). Cite it as
  "Natural Earth (2019 estimates)".
- `find` looks up anything in the bundled data:
  `node <skill-dir>/scripts/map.mjs find "Springfield" --country USA`.

Datasets, join keys, licenses and border caveats: [references/data.md](references/data.md).

## City posters

```bash
node <skill-dir>/scripts/map.mjs poster --place "Lisbon" --country PRT --theme azulejo --radius 4
```

Or a spec with `"kind": "poster"`. `radiusKm` is half the poster's width on the
ground: 1.5–3 for an old town (building footprints fill the blocks), 4–6 for a city
center, 10–30 for a whole metro as fine street lace. Add `--pin "Label"` (or
`markers` in a spec) to mark a spot. Neighborhoods and landmarks need
coordinates: ask the user rather than guessing. Posters download OpenStreetMap
vector tiles from OpenFreeMap (Overpass as fallback) and cache them. Keep the
generated credit: "© OpenMapTiles.org © OpenStreetMap contributors" for vector
tiles, or "© OpenStreetMap contributors" for Overpass. The HTML shows hover
details for supported features with names in the source data.
Details: [references/posters.md](references/posters.md).

## When something goes wrong

- `Could not locate "X"`: use the suggested match, add `country`, or give `lon`/`lat`.
- `matched no countries feature`: use ISO alpha-3 codes in the join column.
- A point "falls outside this projection": Albers USA only covers the 50 states
  and DC; use `"region": "auto"` or a bbox.
- No PNG: no supported browser was found. The CLI looks for Chrome, Edge,
  Brave, Chromium and Playwright's Chromium. Set `MAP_DESIGN_BROWSER` to a
  browser binary, or use the HTML's PNG button.
- `not longitude/latitude; the file is in a projected coordinate system`: run
  the conversion command from the message, then point the spec at the new file.
- `No data rows match any area`: compare the listed columns and properties,
  then set `join` and `boundaries.id`.
- Overpass errors for posters: wait a minute and retry, reduce `radiusKm`, or
  set `"overpass"` to another endpoint.
