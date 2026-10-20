# City posters

A poster is the street network of a place drawn as art: roads by importance,
water, parks, the coastline, and the city's name set like a print.

## Make one

```bash
node <skill-dir>/scripts/map.mjs poster --place "Lisbon" --country PRT --theme azulejo --radius 4
```

or a spec:

```json
{ "kind": "poster", "place": "Lisbon", "country": "PRT", "theme": "azulejo", "radiusKm": 4 }
```

Output: `lisbon-azulejo.html`, `.svg`, and a 3600×4800 `.png` (12×16 in at
300 dpi). Use `--out` to choose the name.

## Choosing the area

`radiusKm` is half the width on the ground. The height follows the poster's
3:4 shape.

| Place | radiusKm |
| --- | --- |
| Old town, island, campus | 1.5–3 |
| City center (Paris inside the Périphérique ≈ 5) | 3–6 |
| Whole city | 6–10 |
| Metro area (road detail depends on source and zoom) | 10–30 |

The gazetteer point for a city is its official center, which may not be the
most interesting frame. Use `center: [lon, lat]` or `offset: [dLon, dLat]` to
include a river, a bay or a historic core. Coastal cities look best when the
water takes a quarter to a third of the frame.

## Mark a place

Pins turn a city poster into a personal one: where you met, a first flat, a
wedding venue, the office.

```bash
node <skill-dir>/scripts/map.mjs poster --lat 19.0990 --lon 72.8265 --title "Juhu" --subtitle "Mumbai" --theme neon --radius 3 --pin "Juhu Beach"
```

`--pin` marks the center; add `--pin-lat` and `--pin-lon` to place it
elsewhere. In a spec, `markers` takes several pins:

```json
"markers": [
  { "label": "Where we met" },
  { "lon": 72.8347, "lat": 19.0596, "label": "Our first flat", "color": "#FF3DA6" }
]
```

Neighborhoods and landmarks are not in the gazetteer, so pins and centers need
coordinates. Ask the user for them or take them from a map they trust. Keep
pins out of the bottom quarter, where the title sits; the report warns when a
pin lands there or outside the frame.

## Themes

| Theme | Look | Good for |
| --- | --- | --- |
| `noir` | White streets on black | Any city; the classic |
| `paper` | Charcoal on warm paper | Printing at home |
| `mono` | Black on white | Laser printers, line art |
| `blueprint` | Cyanotype | Grids: Manhattan, Barcelona, Chicago |
| `sumi` | Ink on washi with a red seal | Japanese and Chinese cities, old towns |
| `terracotta` | Burnt orange on sandstone | Mediterranean and desert cities |
| `azulejo` | Cobalt on white | Lisbon, Porto, coastal towns |
| `neon` | Magenta and violet on night | Megacities, nightlife districts |
| `forest` | Cream on deep green | Green cities, parks, mountain towns |

## How it works

1. The place resolves from the bundled gazetteer (or your coordinates).
2. Streets, buildings, water, parks and rail inside the frame download as
   OpenStreetMap vector tiles (OpenMapTiles schema) from OpenFreeMap and are cached
   in `~/.cache/map-design/vector` (override the base with `MAP_DESIGN_CACHE`).
   Re-rendering with the same cached tiles can work offline. The zoom decreases
   to fit the tile budget: smaller frames usually use zoom 14, which carries
   building footprints; wider frames use lower zooms and may omit finer detail.
3. If the tile service is unreachable, one query goes to the public Overpass API
   instead and the sea is rebuilt from OpenStreetMap coastline ways. `"source":
   "overpass"` always uses Overpass; `"source": "vector"` never falls back.
4. Streets are drawn minor to major. Each class fades from the theme's road colour
   toward the background, and arteries get a thin background-coloured casing, so
   the main roads read first and side streets become texture.
5. Building footprints fill the blocks up to `radiusKm` 3 (a 6 km wide frame)
   when they fit in about 8 MB of SVG. Wider, they blur into a haze that dulls the
   streets. The report says when they were left out; `"layers": { "buildings": true }`
   forces them.

## Hover details

The HTML page names what is under the cursor and outlines it in the theme's
accent colour: a street's name, class, route number and length in view; a river or
canal; a park, garden or cemetery and its area; a landmark building (museum,
monument, place of worship…) and its estimated height when available. Names come
from the tiles; unnamed or unsupported features have no named hover target. Green
areas and buildings take the name of the point of interest inside them. Pins show
their label and coordinates. The index is in the HTML only; the SVG and PNG stay
clean.

## Capitals

Titles are capitalised in the place's language: Turkish and Azerbaijani keep the
dotted İ, Greek drops accents. The language comes from the country of `place`, or
of the country under `center`; `"lang": "tr"` overrides it.

## Etiquette and limits

- OpenFreeMap is free and donation-funded. Its
  [terms](https://openfreemap.org/tos/) allow at most 3,000 tiles or 50 MB per
  download; tile counts and download sizes depend on latitude and local density.
  The renderer enforces the limits and asks for a smaller radius past them.
- The public Overpass API, the fallback, is shared and free. One poster is one
  query. Do not loop over many cities without pauses, and use the cache.
- Keep "© OpenMapTiles.org © OpenStreetMap contributors" on vector posters.
  The OpenMapTiles schema's design attribution and OpenStreetMap's Open Database
  License credit apply to the downloaded data; Overpass-only posters need the
  OpenStreetMap credit.
- Tunnels and subways are left out so the street pattern stays readable.
