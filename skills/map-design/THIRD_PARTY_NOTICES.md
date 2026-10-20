# Third-party notices

map-design's own code is MIT licensed (see [LICENSE](LICENSE)). This skill
ships the following third-party code, data and fonts.

## Code

`scripts/vendor/geo.mjs` and `scripts/vendor/geo.iife.js` bundle:

- [d3-geo](https://github.com/d3/d3-geo) 3.1.1, Copyright 2010-2024 Mike
  Bostock, ISC License. Its upstream license also includes the GeographicLib
  notice, Copyright 2008-2012 Charles Karney (MIT). The complete upstream text
  is in [d3-geo-LICENSE](scripts/vendor/licenses/d3-geo-LICENSE).
- [d3-array](https://github.com/d3/d3-array) 3.2.4, Copyright 2010-2023 Mike
  Bostock, ISC License. Complete text:
  [d3-array-LICENSE](scripts/vendor/licenses/d3-array-LICENSE).
- [topojson-client](https://github.com/topojson/topojson-client) 3.1.0,
  Copyright 2012-2019 Michael Bostock, ISC License. Complete text:
  [topojson-client-LICENSE](scripts/vendor/licenses/topojson-client-LICENSE).

`scripts/vendor/vtile.mjs` bundles the vector tile decoder:

- [pbf](https://github.com/mapbox/pbf) 4.0.2, Copyright (c) 2024 Mapbox,
  BSD 3-Clause License. Complete text: [pbf-LICENSE](scripts/vendor/licenses/pbf-LICENSE).
- [@mapbox/vector-tile](https://github.com/mapbox/vector-tile-js) 2.0.5,
  Copyright (c) 2024 Mapbox, BSD 3-Clause License. Complete text:
  [mapbox-vector-tile-LICENSE](scripts/vendor/licenses/mapbox-vector-tile-LICENSE).
- [@mapbox/point-geometry](https://github.com/mapbox/point-geometry) 1.1.0,
  Copyright (c) 2024 Mapbox, ISC License. Complete text:
  [mapbox-point-geometry-LICENSE](scripts/vendor/licenses/mapbox-point-geometry-LICENSE).

`scripts/lib/polylabel.mjs` follows the polylabel algorithm by Vladimir
Agafonkin (Mapbox), ISC License, Copyright (c) 2016 Mapbox. The upstream
license text is in [polylabel-LICENSE](scripts/vendor/licenses/polylabel-LICENSE).

## Data

- [Natural Earth](https://www.naturalearthdata.com/) vector data (countries,
  first-level subdivisions, populated places, lakes, rivers): public domain.
  Simplified and converted to TopoJSON by the repository's `tools/build-data.mjs`.
- [us-atlas](https://github.com/topojson/us-atlas) 3.0.1 (ISC), built from US
  Census Bureau cartographic boundary files: public domain. The upstream
  license text is in [us-atlas-LICENSE](scripts/vendor/licenses/us-atlas-LICENSE).
- [OurAirports](https://ourairports.com/data/) airport data: public domain.
- City posters download data from [OpenStreetMap](https://www.openstreetmap.org/copyright)
  at render time. OpenStreetMap data is © OpenStreetMap contributors and
  available under the Open Database License 1.0. Posters print the credit and
  copyright URL. OpenStreetMap downloads are not bundled in this skill.
- Repository examples: `examples/us-population-change/states.csv` is derived
  from the US Census Bureau Vintage 2024 population estimates (public domain).
  Other examples use the bundled Natural Earth and OurAirports data, or cite
  the historical route they illustrate.

## Fonts

All fonts are under the [SIL Open Font License 1.1](https://openfontlicense.org/),
copied from the Fontsource packages. License texts are in [fonts/licenses/](fonts/licenses/).

- Libre Franklin, Copyright 2020 The Libre Franklin Project Authors
- Source Serif 4, Copyright Adobe, with Reserved Font Name "Source"
- Jost, Copyright 2020 The Jost Project Authors
- EB Garamond, Copyright 2017 The EB Garamond Project Authors
- IBM Plex Mono, Copyright 2017 IBM Corp.

Embedding these fonts in a rendered map is allowed by the OFL; the fonts
themselves may not be sold on their own.
