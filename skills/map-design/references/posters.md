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
| Metro area (major roads only) | 10–20 |

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
2. Streets, water, parks, rail and coastline inside the frame download from the
   public Overpass API as one query, and are cached in `~/.cache/map-design/osm`
   (override with `MAP_DESIGN_CACHE`). Re-rendering with another theme is offline.
3. The sea is reconstructed from OpenStreetMap coastline ways, which keep land
   on their left. If the coastline cannot be closed cleanly the sea is left
   unshaded and the report says so.
4. Streets are drawn minor to major with widths scaled to the frame.

## Etiquette and limits

- The public Overpass API is shared and free. One poster is one query. Do not
  loop over many cities without pauses, and use the cache.
- Big frames in dense cities can take a minute to download and produce SVGs
  of 5 to 20 MB. Use `detail: "low"` or a smaller radius if that is a problem.
- Keep "© OpenStreetMap contributors" on the poster. It is required by the
  Open Database License.
- Tunnels and subways are left out so the street pattern stays readable.
