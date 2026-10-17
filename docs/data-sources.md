# Rebuilding the bundled data

The files in `skills/map-design/data/` are built from these downloads. Put them
in one folder and run `npm run build:data -- <folder>`.

| File | URL |
| --- | --- |
| `ne_110m_admin_0_countries_lakes.geojson` | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries_lakes.geojson |
| `ne_50m_admin_0_countries_lakes.geojson` | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries_lakes.geojson |
| `ne_10m_admin_1_states_provinces_lakes.geojson` | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lakes.geojson |
| `ne_10m_populated_places_simple.geojson` | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson |
| `ne_50m_lakes.geojson` | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson |
| `ne_50m_rivers_lake_centerlines.geojson` | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson |
| `airports.csv` | https://davidmegginson.github.io/ourairports-data/airports.csv |

US states and counties come from the `us-atlas` dev dependency. Fonts come from
the `@fontsource` dev dependencies (`npm run build:fonts`). The geo bundle comes
from `d3-geo`, `d3-array` and `topojson-client` (`npm run build:vendor`).

Simplification: world outlines keep all 1:110m points and 35% of 1:50m points;
first-level regions keep about 6,000 points per country, dropping small
detached islands in the largest countries; all coordinates are quantized.
