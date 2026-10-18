---
name: map-design
description: Make real, accurate maps as one self-contained HTML, SVG and PNG. Choropleths by country, state, province or US county; bubble, spike and point maps; routes and voyages; flow maps; locator maps with an inset globe; and OpenStreetMap city posters. Use whenever the user asks for a map, a "where is" graphic, data by country/state/county/region, a trip, flight or shipping route, a city poster, or any geographic visualization. Ships Natural Earth, US Census and OurAirports data, so coastlines, borders and coordinates are real rather than drawn from memory.
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
2. **Get the data.** Use the user's file as is (CSV or JSON, path relative to
   the spec). For public statistics, fetch from a primary source and record it
   in `source`. Never invent values. If you must show placeholder numbers,
   say so in `subtitle` or `note`.
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
| Counts or totals at places | `bubbles` | Circle area ∝ value. |
| Many values at points, dense areas | `spikes` | Height ∝ value; good for population. |
| Locations, optionally by category | `points` | Stores, offices, sightings. |
| An ordered trip, voyage or itinerary | `route` | `mode: "flight"` uses airport codes. |
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

## Basemaps (street-level detail)

The vector geography is Natural Earth at 1:50m: accurate at country scale, blocky at city scale. When a map
needs real streets under the data, ask for raster tiles:

```json
{ "kind": "points", "basemap": "dark", "theme": "ink",
  "region": { "center": [12.55, 55.68], "radiusKm": 6 } }
```

- Keyless presets: `osm`, `osm-hot`. CARTO presets (`carto-light`, `carto-dark`, `carto-voyager`) need an API key —
  without one they answer HTTP 200 with a watermarked tile, so the report warns rather than shipping it silently.
  Or point at your own server: `{ "url": "https://…/{z}/{x}/{y}.png", "attribution": "…" }`.
- For a dark basemap on a dark theme without a key, invert the OSM tiles:
  `{ "preset": "osm", "filter": "invert(1) hue-rotate(180deg) brightness(0.9) saturate(0.55)" }`.
- The projection is forced to `mercator` — tiles are Web Mercator squares and shear under anything else. The
  report says when that happened.
- Zoom is chosen automatically: the highest zoom that fits `maxTiles` (default 144) without stretching a tile past
  1.5× its native 256 px. Override with `"zoom": 15`, or raise the budget (`"maxTiles": 400`) for a one-off city print.
  `MAP_DESIGN_DEBUG_TILES=1` prints the tile budget and the chosen zoom for every render.
- `filter` / `opacity` let the imagery sit under data: `{ "preset": "dark", "filter": "saturate(0.6) brightness(0.72)" }`.
- Tiles are embedded as data URIs, so HTML and SVG stay self-contained, and cached in
  `$XDG_CACHE_HOME/map-design/tiles` (`MAP_DESIGN_TILE_CACHE` overrides), so re-renders cost nothing.
- Tiles that fail are retried with backoff; anything still missing is reported (a gap in the imagery is visible,
  so it must never be silent). If every tile fails the map keeps the vector geography and the report says why.
- Respect the host's tile policy. For bulk work, point `url` at your own tile server or a keyed provider.

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
ground: 1.5–3 for an old town, 4–6 for a city center, 8–15 for a metro area
(larger areas switch to major roads only). Add `--pin "Label"` (or
`markers` in a spec) to mark a spot. Neighborhoods and landmarks need
coordinates: ask the user rather than guessing. Posters download OpenStreetMap data
from the public Overpass API, cache it, and must keep the
"© OpenStreetMap contributors" credit. Details: [references/posters.md](references/posters.md).

## When something goes wrong

- `Could not locate "X"`: use the suggested match, add `country`, or give `lon`/`lat`.
- `matched no countries feature`: use ISO alpha-3 codes in the join column.
- A point "falls outside this projection": Albers USA only covers the 50 states
  and DC; use `"region": "auto"` or a bbox.
- No PNG: no supported browser was found. Set `MAP_DESIGN_BROWSER` to a Chrome
  or Edge binary, or use the HTML's PNG button.
- Overpass errors for posters: wait a minute and retry, reduce `radiusKm`, or
  set `"overpass"` to another endpoint.
