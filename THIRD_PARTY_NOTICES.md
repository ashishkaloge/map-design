# Third-party notices

map-design's own code is MIT licensed (see [LICENSE](LICENSE)). It ships the
following third-party code, data and fonts inside `skills/map-design/`.

## Code

`scripts/vendor/geo.mjs` and `scripts/vendor/geo.iife.js` bundle:

- [d3-geo](https://github.com/d3/d3-geo) 3.1.1, Copyright 2010-2024 Mike
  Bostock, ISC License.
- [d3-array](https://github.com/d3/d3-array) 3.2.4, Copyright 2010-2023 Mike
  Bostock, ISC License.
- [topojson-client](https://github.com/topojson/topojson-client) 3.1.0,
  Copyright 2012-2019 Michael Bostock, ISC License.

ISC License: Permission to use, copy, modify, and/or distribute this software
for any purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies. THE SOFTWARE
IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO
EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA
OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS
ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
SOFTWARE.

`scripts/lib/polylabel.mjs` follows the polylabel algorithm by Vladimir
Agafonkin (Mapbox), ISC License.

## Data

- [Natural Earth](https://www.naturalearthdata.com/) vector data (countries,
  first-level subdivisions, populated places, lakes, rivers): public domain.
  Simplified and converted to TopoJSON by `tools/build-data.mjs`.
- [us-atlas](https://github.com/topojson/us-atlas) 3.0.1 (ISC), built from US
  Census Bureau cartographic boundary files: public domain.
- [OurAirports](https://ourairports.com/data/) airport data: public domain.
- City posters download data from [OpenStreetMap](https://www.openstreetmap.org/copyright)
  at render time. OpenStreetMap data is © OpenStreetMap contributors and
  available under the Open Database License 1.0. Posters print the required
  credit. No OpenStreetMap data is stored in this repository except the small
  synthetic test fixture in `tests/fixtures/`, which was written by hand.
- Example data: `examples/us-population-change/states.csv` is derived from the
  US Census Bureau Vintage 2024 population estimates (public domain).
  Other examples use the bundled Natural Earth and OurAirports data.

## Fonts

All fonts are under the [SIL Open Font License 1.1](https://openfontlicense.org/),
copied from the Fontsource packages. License texts are in
`skills/map-design/fonts/licenses/`.

- Libre Franklin, Copyright 2020 The Libre Franklin Project Authors
- Source Serif 4, Copyright Adobe, with Reserved Font Name "Source"
- Jost, Copyright 2020 The Jost Project Authors
- EB Garamond, Copyright 2017 The EB Garamond Project Authors
- IBM Plex Mono, Copyright 2017 IBM Corp.

Embedding these fonts in a rendered map is allowed by the OFL; the fonts
themselves may not be sold on their own.
