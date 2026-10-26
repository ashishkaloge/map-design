# Spec reference

A spec is one JSON object. `kind` is required; everything else has a default.
Paths in `data`, `stops`, `flows`, `boundaries`, `track` and `highlight` are
relative to the spec file.

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
| `basemap` | string or object | none | `"streets"`: vector streets, water, parks and buildings in the theme's colours, any projection, with hover names (`{ preset: "streets", maxTiles, zoom, opacity }`). Or raster tiles drawn under the data: `"osm"`, `"osm-hot"` (keyless), the aliases `"light"`, `"dark"`, `"voyager"`, the CARTO presets `"carto-light"`/`"carto-dark"`/`"carto-voyager"` (need an API key), or `{ preset, url, attribution, zoom, maxTiles, maxZoom, opacity, filter, cache }`. Raster tiles force `mercator` (tiles are Web Mercator) and credits the source in the footer. A custom `url` is http(s) with `{z}/{x}/{y}`. `zoom`, `maxZoom` and `maxTiles` are bounded integers (`maxTiles` ≤ 4096); the tile budget is enforced even with an explicit `zoom`. `opacity` is 0-1; `filter` accepts plain CSS filter functions only. Invalid values are spec errors. See [provider and cache requirements](basemaps.md). |
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
Rows read from GeoJSON, GPX or KML use their own geometry: a point is the
location, an area's centroid stands in for it, and lines are left for routes.
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
| `data` | Rows (array) or a CSV/JSON path, or `"builtin:countries"`. A GeoJSON, TopoJSON or KML of polygons shades each polygon by its own properties. |
| `boundaries` | Your own areas: a GeoJSON, TopoJSON or KML path, or `{ "file", "id", "name", "object" }`. `id` is the feature property that matches `join`; `name` labels areas; `object` picks one object of a TopoJSON file. See [your own geometry](#your-own-geometry). |
| `join` | Column with the area key. Auto-detected from common names (`iso3`, `country`, `state`, `fips`, `name`, …). With `boundaries`, columns are compared with feature properties, preferring distinct matching keys; ambiguous mappings require explicit `join` and `boundaries.id`. |
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
The same holds for your own areas that are smaller than the drawing's detail.

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
| `track` | A recorded line: GPX (tracks and routes), KML or GeoJSON LineStrings. Drawn as recorded, not as great circles. The file's waypoints, or `stops` if given, become unnumbered markers; without either, the start and end are marked. |
| `routes` | Several routes: `[{ "name": "2024", "stops": [...], "color": "#…" }]` or `[{ "track": "day1.gpx" }]`; adds a legend. A track's own name is used when `name` is left out. |
| `mode` | `flight` (strings resolve as airport codes), `voyage` or `sea` (dashed line; `voyage` defaults to the antique theme), `road`. |
| `line` | `great-circle` (default), `straight`, or `arc` (a bowed curve). |
| `numbered` | Numbered stop badges. Default true for a single route of up to 30 stops. |
| `lineWidth`, `labelSize` | Sizes at the 1600px reference. |

The report prints the total great-circle length, or the track length, in km
and miles. A local track (a run, a ride) frames tightly and leaves out country
outlines; add `"basemap": "streets"` for the streets under it.

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
| `highlight` | A country, `{ "admin1": "Bavaria", "country": "DEU" }`, a place, coordinates, a GeoJSON, TopoJSON or KML path (`"site.geojson"` or `{ "file", "label" }`), or an array of these. A file's areas are highlighted together; its points are marked. |
| `cities` | `true` or a number: mark the largest cities in the highlighted countries, or inside a highlighted file's areas; capitals are squares. |
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
| `source` | `auto` (default: OpenFreeMap vector tiles, Overpass if they are unreachable), `vector` or `overpass`. |
| `lang` | Language tag for the capitalised title lines, e.g. `"tr"`. Defaults from the country: Turkish and Azerbaijani keep the dotted İ, Greek drops accents. |
| `coords` | `false` hides the coordinate line. |
| `detail` | `low` (major roads), `medium` (default; includes residential roads), `high` (adds service roads and paths). Availability depends on the source and zoom. With the Overpass source, areas wider than 9 km default to `low`. |
| `layers` | `{ "water": false, "parks": false, "rail": false, "buildings": false }` to hide layers; buildings are drawn up to `radiusKm` 3 by default, and `"buildings": true` draws them at any size. |
| `markers` | Labeled pins: `[{ "label": "Juhu Beach" }]` marks the center; add `lon`/`lat` (or `place`) to put a pin elsewhere. Optional `color` and `size`. |
| `size` | Default `poster` (1200×1600, exported at 3× = 3600×4800). |
| `overpass` | Another Overpass API endpoint URL. |

## Your own geometry

| Format | Extensions | What is read |
| --- | --- | --- |
| GeoJSON | `.geojson`, `.json` | Features, a single Feature or a bare geometry. Properties become columns. |
| TopoJSON | `.topojson`, `.json` | The object with the most geometries, or the one named by `object`. |
| GPX | `.gpx` | Waypoints (points with `name`, `desc`, `ele`, `time`), routes and tracks (lines; elevation kept as a third coordinate). |
| KML | `.kml` | Every Placemark in any folder: Point, LineString, LinearRing, Polygon with holes, MultiGeometry, `gx:Track`. `name`, `description` (tags removed) and ExtendedData become properties. Styles are ignored. |

- Automatic boundary joins require unique nonempty keys. If several fields
  produce different equally good mappings, set `join` and `boundaries.id`.
  For repeated IDs representing parts of the same area, name `boundaries.id`
  explicitly; the parts are grouped under that ID.
- Coordinates must be longitude/latitude (WGS 84). Values outside ±90° latitude
  or ±360° longitude mean a projected file; the CLI stops with a conversion
  command for mapshaper or ogr2ogr. A declared projected or unsupported `crs`
  is rejected for geometry even when its numbers fit inside those ranges;
  coordinates are never reprojected automatically.
- Shapefiles, GeoPackages and KMZ are not read directly; the error says how to
  convert or unzip them.
- Rings may wind either way and may be left open. Edges longer than a degree
  get intermediate points so they follow the parallel, as GIS tools draw them.
- Explicit boundaries, highlights and tracks reject invalid coordinates and
  malformed geometry. Missing geometry is counted in the report. When a file
  is loaded as a table, its properties remain usable and invalid geometry is
  ignored with a note; other columns can still locate the row.
- Lines and areas are thinned to a quarter pixel when drawn, so a 100,000-point
  track or a detailed boundary file stays a small SVG. Files with more than
  400,000 vertices get a note suggesting `mapshaper -simplify` for speed.
- Areas or tracks smaller than about 280 km across frame tightly and leave out
  the Natural Earth land, borders and coastline, which are too coarse to line up.
  `"basemap": "streets"` draws OpenStreetMap streets and water instead.
