# Basemaps

A basemap adds street detail underneath editorial maps. It is optional: maps using
the bundled vector geography remain offline.

## Streets (vector, recommended)

```json
{ "basemap": "streets" }
{ "basemap": { "preset": "streets", "maxTiles": 200, "zoom": 13, "opacity": 0.9 } }
```

Draws roads (fading by class), water, parks, rail and, at the closest zoom,
building footprints from OpenStreetMap vector tiles in the
[OpenMapTiles](https://openmaptiles.org/) schema, served free by
[OpenFreeMap](https://openfreemap.org/). Colours come from the map's theme, so the
basemap stays quiet under the data. It keeps the map's own projection, stays sharp
at any export size, and replaces the bundled 1:50m coastline with the real one.
Named streets, waterways and parks get hover details in the HTML.

- Automatic zoom follows the map's scale and steps down until the tile count
  fits `maxTiles` (default 144, at most 3,000). An explicit `zoom` (0–14)
  is preserved; if it exceeds the tile budget, rendering fails before downloading.
- It is meant for city and regional frames; frames wider than 60° of longitude
  are rejected.
- Tiles are cached under `~/.cache/map-design/vector` and reused. A render can work
  offline when its tiles and TileJSON are cached; source metadata is refreshed
  after 12 hours, with a stale copy used if the source is unreachable.
  `MAP_DESIGN_TILEJSON` points at another OpenMapTiles-schema source, such as your
  own tile server. Verify that the source permits the intended downloads and that
  its required attribution is covered by the generated footer; extra attribution
  in a custom TileJSON is not automatically included.
- [OpenFreeMap's terms](https://openfreemap.org/tos/) allow downloads from apps
  of at most 3,000 tiles or 50 MB, four requests at a time, with an identifying
  User-Agent; the renderer enforces all three. Commercial use is allowed. The
  footer credits © OpenMapTiles.org and © OpenStreetMap contributors with the
  copyright URLs; keep them visible.
- If the tile service cannot be reached, the map falls back to the bundled
  geography and the report says so.

## Raster tiles

Raster presets embed tile images. They use Mercator, including world and dateline
frames, and embed tiles in the SVG and HTML.

### Options

Use a preset name or an object:

```json
{
  "basemap": {
    "preset": "osm",
    "maxTiles": 144,
    "opacity": 0.8,
    "filter": "saturate(0.6) brightness(0.9)"
  }
}
```

- `osm` and `light` use OpenStreetMap's standard tiles. `dark` uses the same
  tiles with `invert(1) hue-rotate(180deg) brightness(0.9) saturate(0.55)`.
- `osm-hot` uses the humanitarian style hosted by OpenStreetMap France.
- `carto-light`, `carto-dark`, `carto-voyager` and the `voyager` alias require
  your own CARTO key. Supply a `url` containing `?key=YOUR_KEY` with the corresponding
  `preset` so attribution remains correct. Missing, blank or duplicate `key`
  parameters are rejected before downloading, including during `check`.
  Never publish a spec containing a private provider key.
- `url` is an HTTP(S) template containing `{z}`, `{x}` and `{y}`. For a custom
  provider, supply its required `attribution`. Redirects are rejected; use the
  provider's final tile endpoint. Responses must declare `image/png` and contain
  PNG bytes; JPEG and other image formats are not supported.
- `zoom` and `maxZoom` are integers from 0 to 25. Presets default to their service
  maximum of 19 or 20; `zoom` is clamped to the configured `maxZoom`.
- `maxTiles` is an integer from 1 to 4096, default 144. The highest zoom within
  the budget is selected. An explicit zoom over budget is reduced with a warning.
  Wrapped edge placements reuse a downloaded tile. This caps requests, not image
  sharpness: a small budget can produce blurry tiles.
- `opacity` is a number from 0 to 1. `filter` accepts numeric brightness, contrast,
  grayscale, invert, opacity, saturate and sepia functions, pixel blur and angle
  hue-rotate. URL filters and drop shadows are rejected.
- `cache` defaults to true where permitted. OSM's standard service requires
  caching. CARTO disk caching is always disabled, including custom keyed URLs,
  because its terms prohibit server-side caching. Other cached tiles are reused
  for seven days, then refreshed on the next request.

The cache is `$XDG_CACHE_HOME/map-design/tiles`, defaulting to
`~/.cache/map-design/tiles`; `MAP_DESIGN_TILE_CACHE` overrides the directory.
Four workers fetch tiles, with at most three attempts per tile and backoff.
Each attempt has a ten-second timeout and a 2 MiB response cap. These are
per-attempt limits, not a ten-second or 2 MiB limit for the whole map. Keep the
budget modest; large budgets increase render time, memory and output size.
`MAP_DESIGN_DEBUG_TILES=1` prints bounds, zoom and count without request URLs.

Failed tiles are reported. Non-PNG responses and invalid cache headers are rejected
rather than embedded as successful images. If every tile fails, the renderer uses
vector geography. `check` validates options and locations without fetching or writing.

### Provider requirements

Terms can change; check the linked primary sources for your intended use.
Keep generated credits and copyright links visible, including in exported PNGs.

#### OpenStreetMap standard tiles

`osm`, `light` and `dark` use `tile.openstreetmap.org`. Its
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
requires an identifying User-Agent, visible attribution and caching. The renderer
identifies itself and retains tiles for at least seven days. Do not use this
service for bulk downloads, prefetching or offline-map products. For those
workloads, use self-hosted tiles or a provider that explicitly permits them.
Embedding a finished map does not establish permission for a bulk/offline
workflow. See the [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
for the map's credits and licence notice.

#### OpenStreetMap France

`osm-hot` is hosted by OpenStreetMap France; it is not governed by the standard
OSMF tile-service policy above. Its [map guidance](https://www.openstreetmap.fr/fonds-de-carte/)
allows attributed paper prints and screenshots under the associated licence.
Its [service policy](https://www.openstreetmap.fr/usage/) sets separate conditions
for website/application use, including public access, nonprofit use and moderate
traffic, with only limited corporate-site tolerance. Other uses need an appropriate
provider or permission. The footer credits the data contributors, HOT style and
OpenStreetMap France hosting, with the copyright URL visible and clickable.

#### CARTO

Use your own key and retain both CARTO and OpenStreetMap attribution. Section 8
requires a key for all requests; unauthenticated presets are rejected rather than
downloading watermarked imagery.
The [CARTO basemap terms](https://carto.com/legal/basemap-terms/), section 9,
prohibit server-side caching and cap end-user cache retention at 30 days.
The renderer therefore never reads or writes a disk cache for
`basemaps.cartocdn.com` or its documented `a`/`b`/`c`/`d` tile subdomains, even
when `cache: true` is requested. The same host checks enforce the key requirement
for custom URLs. See the [official tile URL formats](https://github.com/CartoDB/basemap-styles).

Section 9.d permits attributed screenshots and other static images for
illustrative, editorial or documentary purposes. This is not blanket permission
to redistribute raw tiles, build a tile archive or offer offline tile access.
Check the terms and the [provider's current setup instructions](https://carto.com/basemaps/)
before using or sharing an export.

For custom providers, confirm access, caching, attribution and export permission
with that provider. A custom URL alone does not establish these rights.
