# Spec reference

A spec is one JSON object. `kind` is required; everything else has a default.
Paths in `data`, `stops` and `flows` are relative to the spec file.

## Fields every kind accepts

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `kind` | string | required | `choropleth`, `bubbles`, `spikes`, `points`, `route`, `flows`, `locator`, `poster` |
| `title` | string | none | The finding, in one line. |
| `subtitle` | string | none | What is measured, where, when. Wraps to four lines. |
| `kicker` | string | none | Small uppercase line above the title. |
| `source` | string | none | Printed as "Source: …" in the footer. |
| `note` | string | none | Footnote for caveats. |
| `credit` | string | none | Author or publisher, after the source. |
| `theme` | string | `paper` | `paper`, `atlas`, `ink`, `antique`, `swiss`, `blueprint` |
| `size` | string or object | by region shape | `landscape` 1600×1000, `wide` 1600×900, `square` 1200×1200, `portrait` 1200×1500, `story` 1080×1920, `poster` 1200×1600, `a4`, or `{ "width", "height" }` |
| `region` | see below | by kind | What the map frames. |
| `projection` | string or object | automatic | `equal-earth`, `natural-earth`, `globe`, `orthographic`, `albers-usa`, `albers`, `conic-equal-area`, `conic-conformal`, `azimuthal-equal-area`, `mercator`, `transverse-mercator`, `equirectangular`, `stereographic`. Object form: `{ "name", "rotate": [λ, φ], "parallels": [a, b] }`. |
| `basemap` | string or object | none | Raster tiles drawn under the data: `"osm"`, `"osm-hot"`, `"light"`, `"dark"`, `"voyager"`, or `{ preset, url, attribution, zoom, maxTiles, opacity, filter, cache }`. Forces `mercator` (tiles are Web Mercator) and credits the source in the footer. A custom `url` takes `{z}/{x}/{y}`. |
| `antarctica` | boolean | `false` | World maps crop Antarctica unless true. |
| `graticule` | boolean | by theme | Latitude and longitude lines. |
| `rivers` | boolean | by theme | Major rivers. |
| `legend` | `false` or object | shown | `{ "title": "…" }`; choropleths also take `"noData": false`. |
| `format` | object | none | `{ "prefix": "$", "suffix": "%", "decimals": 1, "compact": true }` for values in legends and labels. `compact` writes 1.2M, 340K. |
| `annotations` | array | none | `[{ "at": <location>, "text": "Line one\nline two", "dx": 40, "dy": -30 }]`. `dx`/`dy` move the text from the point in pixels at the 1600px reference size. |

### `region`

- `"world"`: Equal Earth, Antarctica cropped.
- `"usa"`: Albers USA with Alaska and Hawaii insets.
- An area: `europe`, `western europe`, `nordics`, `africa`, `asia`,
  `middle east`, `south asia`, `east asia`, `southeast asia`, `north america`,
  `central america`, `caribbean`, `south america`, `oceania`, `arctic`.
- A country, by name or ISO code: `"IND"`, `"Japan"`. Far territories such as
  French Guiana are left out of the frame. `"USA"` uses Albers USA.
- Several countries: `["DEU", "FRA", "ITA"]`.
- A bounding box: `[west, south, east, north]` in degrees.
- `{ "center": [lon, lat], "radiusKm": 300 }`.
- `"auto"`: fit the data. Points, routes and flows default to `"auto"` when
  they cover less than about a third of the globe.

### Locations

Wherever a row or reference needs a place, any of these work:

```json
{ "lon": -9.14, "lat": 38.72 }        coordinates (also lng, longitude, latitude)
[ -9.14, 38.72 ]                      coordinates as an array
{ "iata": "LHR" }                     airport (IATA or ICAO code)
{ "place": "Paris", "country": "FR" } city from the gazetteer
{ "country": "Kenya" }                country label point
{ "state": "TX" }                     US state
{ "admin1": "Kerala", "country": "IND" }  first-level region
"Paris, France"                       place, country
"JFK"                                 airport when the spec has "mode": "flight"
```

In data rows, put these fields on the row itself (`place`, `country`, `lon`,
`lat`, …) or put a reference in one column and name it with `"location"`.
Ambiguous names (Springfield, Portland, San José) resolve to the largest match
and print a warning listing the others.

## choropleth

```json
{
  "kind": "choropleth",
  "region": "usa",
  "title": "…",
  "data": "by-state.csv",
  "join": "state",
  "value": "rate",
  "scale": { "type": "quantile", "classes": 5, "palette": "blue" },
  "format": { "suffix": "%" },
  "labels": "names"
}
```

| Field | Meaning |
| --- | --- |
| `data` | Rows (array) or a CSV/JSON path, or `"builtin:countries"`. |
| `join` | Column with the area key. Auto-detected from common names (`iso3`, `country`, `state`, `fips`, `name`, …). |
| `value` | Numeric column (or category column with `scale.type: "categorical"`). |
| `geography` | `countries`, `admin1`, `us-states`, `us-counties`. Inferred from `region` and the keys. |
| `scale.type` | `quantile` (default), `equal`, `jenks`, `threshold` (with `breaks`), `continuous`, `categorical`. |
| `scale.classes` | 2–9, default 5. |
| `scale.breaks` | Upper-open class limits for `threshold`, e.g. `[10, 20, 40]`. |
| `scale.palette` | Sequential: `teal`, `blue`, `green`, `purple`, `red`, `orange`, `gray`, `amber`, `magma`, `viridis`, `ice`. Diverging: `red-blue`, `brown-teal`, `purple-green`, `orange-blue`. Categorical: `editorial`, `vivid`, `muted`, `neon`. |
| `scale.reverse` | Flip the palette. |
| `scale.center` | Midpoint for diverging palettes (e.g. `0` or `100`). |
| `scale.colors` | Your own stops (array), or `{ "Category": "#hex" }` for categorical. |
| `labels` | `false`, `true` (short: postal codes for US states), `"names"`, `"values"`, or an array of keys to label. Default: names for regions and US states, none for world maps. |

Join keys by geography:

- `countries`: ISO alpha-3 (`KEN`), alpha-2 (`KE`), numeric (`404`), World
  Bank codes, or names including common variants ("Côte d'Ivoire", "Ivory Coast",
  "Korea, Rep.", "Russian Federation", "Türkiye").
- `admin1`: ISO 3166-2 (`IN-KL`), postal code where one exists, or the name.
- `us-states`: postal (`TX`), FIPS (`48`) or name.
- `us-counties`: five-digit FIPS (`06037`); leading zeros may be missing.

Countries too small to draw at world scale (Singapore, Malta, Pacific
islands) appear as dots in their class color, so their data is not lost.

## bubbles and spikes

```json
{
  "kind": "bubbles",
  "data": "cities.csv",
  "value": "population",
  "label": "name",
  "labelTop": 10,
  "format": { "compact": true },
  "legend": { "title": "Population" }
}
```

| Field | Meaning |
| --- | --- |
| `value` | Required. Circle area (bubbles) or spike height (spikes) is proportional to it. |
| `label` | Column for labels; defaults to `label`, then the resolved place name. |
| `labelTop` | Label the N largest (default 10 bubbles, 8 spikes). |
| `labelValues` | `false` hides the value under each label. |
| `color` | A color (`"#C2412D"`), or `{ "field": "region", "title": "…" }` to color by a column (categories or numbers). |
| `maxRadius` / `maxHeight` | Largest symbol size in px at the 1600px reference (defaults 46 and 190). |
| `spikeWidth` | Spike base width (default 8). |
| `opacity` | Bubble fill opacity (default 0.45). |

## points

| Field | Meaning |
| --- | --- |
| `category` | Column used for color, with a legend. |
| `scale.palette` | Categorical palette name. |
| `label` / `sublabel` | Columns for the label and a second line. |
| `labels` | `false` to hide labels. |
| `radius` | Dot radius (default 5). |

## route

```json
{
  "kind": "route",
  "mode": "flight",
  "title": "Around the world in six flights",
  "stops": ["LHR", "DXB", "SIN", "SYD", "LAX", "JFK", "LHR"]
}
```

| Field | Meaning |
| --- | --- |
| `stops` | Ordered locations (array or file). Each stop may add `label`, `date`, `note`. `"waypoint": true` shapes the line without a marker, e.g. to round a cape. |
| `routes` | Several routes: `[{ "name": "2024", "stops": [...], "color": "#…" }]`; adds a legend. |
| `mode` | `flight` (strings resolve as airport codes), `voyage` or `sea` (dashed line; `voyage` defaults to the antique theme), `road`. |
| `line` | `great-circle` (default), `straight`, or `arc` (a bowed curve). |
| `numbered` | Numbered stop badges. Default true for a single route of up to 30 stops. |
| `lineWidth`, `labelSize` | Sizes at the 1600px reference. |

The report prints the total great-circle length in km and miles.

## flows

```json
{
  "kind": "flows",
  "flows": [{ "from": "Mexico", "to": "USA", "value": 10.7 }],
  "format": { "suffix": "M" },
  "legend": { "title": "Migrants, millions" }
}
```

| Field | Meaning |
| --- | --- |
| `flows` | Rows with `from`, `to` (or `origin`/`destination`) and a value. |
| `value` | Column name for the value (default `value`). |
| `line` | `curve` (default) or `great-circle` (default when `mode` is `flight`). |
| `curvature` | Bow of curved flows (default 0.22). |
| `maxWidth` | Widest flow in px (default 14). |
| `color` | Flow color. |
| `labelTop` | Label the N busiest endpoints (default 14). |

## locator

```json
{ "kind": "locator", "highlight": "Bhutan", "cities": 4, "theme": "atlas" }
```

| Field | Meaning |
| --- | --- |
| `highlight` | A country, `{ "admin1": "Bavaria", "country": "DEU" }`, a place, coordinates, or an array of these. |
| `cities` | `true` or a number: mark the largest cities in the highlighted countries; capitals are squares. |
| `context` | How much surrounding area to show, as a multiple of the highlight's size (default 0.95). |
| `inset` | `false` hides the inset globe. `insetSize` scales it (default 0.12). |
| `contextLabels` | `false` hides neighboring country names. |
| `regions` | `true` draws the first-level borders of the highlighted country. |
| `color`, `opacity` | Highlight fill. |
| `radiusKm` | Context around highlighted places (default 700). |

## poster

```json
{
  "kind": "poster",
  "place": "Kyoto",
  "country": "JPN",
  "radiusKm": 3.5,
  "theme": "sumi"
}
```

| Field | Meaning |
| --- | --- |
| `place` / `country` | City from the gazetteer. Or `center: [lon, lat]`. |
| `offset` | `[dLon, dLat]` to nudge the center, e.g. toward a waterfront. |
| `radiusKm` | Half the poster width on the ground (0.3–30, default 4). |
| `theme` | `noir`, `paper`, `blueprint`, `sumi`, `terracotta`, `azulejo`, `neon`, `forest`, `mono`. |
| `title` / `subtitle` | Override the city and country lines; `"subtitle": false` hides it. |
| `coords` | `false` hides the coordinate line. |
| `detail` | `low` (major roads), `medium` (default; all streets), `high` (adds service roads and paths). Areas wider than 9 km default to `low`. |
| `layers` | `{ "water": false, "parks": false, "rail": false }` to hide layers. |
| `markers` | Labeled pins: `[{ "label": "Juhu Beach" }]` marks the center; add `lon`/`lat` (or `place`) to put a pin elsewhere. Optional `color` and `size`. |
| `size` | Default `poster` (1200×1600, exported at 3× = 3600×4800). |
| `overpass` | Another Overpass API endpoint URL. |
