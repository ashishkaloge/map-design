# Data

Everything below ships inside the skill in `data/` and works offline.

| File | Contents | Source and license |
| --- | --- | --- |
| `world-110m.topo.json` | Country outlines for world maps (lakes cut out) | Natural Earth 1:110m, public domain |
| `world-50m.topo.json` | Country outlines for continent and country maps | Natural Earth 1:50m, public domain |
| `countries.json` | Codes, names, continent, region, population, GDP, income group, label points | Natural Earth, public domain |
| `admin1/<ISO3>.topo.json` | First-level regions (states, provinces, prefectures…) for 251 countries | Natural Earth 1:10m, simplified, public domain |
| `us-states.topo.json`, `us-counties.topo.json` | US states and counties with FIPS codes | US Census Bureau cartographic boundaries via us-atlas, public domain |
| `places.json` | About 7,300 cities and towns with coordinates and population | Natural Earth populated places, public domain |
| `airports.json` | About 3,200 large and medium airports with scheduled service | OurAirports, public domain |
| `physical-50m.topo.json` | Major lakes and rivers | Natural Earth, public domain |

City posters additionally download street, water and park data from
OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0). The credit must stay on
the poster.

## `builtin:countries`

`"data": "builtin:countries"` loads one row per country:

| Column | Meaning |
| --- | --- |
| `iso3`, `name` | ISO 3166-1 alpha-3 code (Natural Earth codes for places without one, e.g. `KOS`) and short name |
| `continent`, `region`, `subregion` | UN-style grouping |
| `population`, `populationYear` | Natural Earth estimate (mostly 2019) |
| `gdpMillionsUsd`, `gdpYear` | GDP in millions of US dollars (mostly 2019) |
| `gdpPerCapita` | GDP ÷ population, US dollars |
| `areaKm2` | Area computed from the 1:50m outline |
| `density` | People per km² |
| `income` | World Bank income group |

These are good enough for quick maps and demos. For current or official
figures, fetch from the publisher and cite it.

## Getting public data

Prefer primary sources and keep the URL in `source`:

- World Bank Indicators API, JSON or CSV, keyed by ISO alpha-3:
  `https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&date=2023&per_page=400`
  (World Bank rows include regional aggregates such as `WLD` or `EUU`; they will
  show up as unmatched and can be ignored.)
- Our World in Data grapher CSVs: `https://ourworldindata.org/grapher/<chart>.csv`,
  with an ISO `Code` column.
- US Census Bureau and BLS: state FIPS (2 digits) and county FIPS (5 digits).
- National statistics offices for admin-1 data; join on the region name or
  ISO 3166-2 code.

Always check the unmatched report. A choropleth that silently drops five
countries is wrong in a way readers cannot see.

## Checking a name

```bash
node <skill-dir>/scripts/map.mjs find "Kerala" --country IND
node <skill-dir>/scripts/map.mjs find "Portland"
node <skill-dir>/scripts/map.mjs find "BOM"
```

## Borders

Natural Earth draws boundaries as they are on the ground ("de facto"), and
its data carries notes where countries disagree. See the borders section of
[cartography.md](cartography.md) before publishing maps of disputed areas.
