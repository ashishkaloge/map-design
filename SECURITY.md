# Security policy

## Supported version

The latest 0.1.x release and the latest commit on `main` receive fixes.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ashishkaloge/map-design/security/advisories/new).
Do not put exploit details in a public issue.

Useful reports include:

- a spec or data file that makes the renderer read or write files outside the
  paths it was given;
- text from a spec or data file that escapes into the SVG or HTML as markup or
  script;
- the CLI contacting any host other than the configured Overpass endpoint, the
  vector tile source (OpenFreeMap by default, or the TileJSON in
  `MAP_DESIGN_TILEJSON`) or a basemap tile host named by the spec (a preset's
  host, or the `basemap.url` host).

## What the tool does

- Reads the spec and the data files it names, and the bundled data.
- Writes `<name>.html`, `<name>.svg` and `<name>.png` where you point it.
- For posters and the `streets` basemap, downloads OpenStreetMap vector tiles
  from OpenFreeMap (`tiles.openfreemap.org`), or from the source named by the
  `MAP_DESIGN_TILEJSON` environment variable, and caches them under
  `~/.cache/map-design/vector`. Downloads follow OpenFreeMap's terms: at most
  3,000 tiles or 50 MB per render, four requests at a time, an identifying
  User-Agent. Each tile is capped at 4 MiB and 30 s per attempt; redirects are
  rejected. If the source is unreachable, a poster sends one query to the public
  Overpass API (or the endpoint you set) instead, cached the same way.
- For maps whose spec asks for a `basemap`, downloads raster tiles from the
  preset's tile host (OpenStreetMap or CARTO) or the http(s) URL the spec names,
  and normally reuses cached tiles for seven days under `~/.cache/map-design/tiles`.
  CARTO responses are never read from or written to this cache, including when
  supplied through a custom keyed URL. Its root and documented tile subdomains
  require a nonempty `key` before any request. Redirects are rejected, and only
  responses declaring PNG with a PNG signature/header are embedded or cached.
  Cache hits also undergo PNG format detection. Fetching is bounded:
  `maxTiles` caps distinct tiles (even with an explicit `zoom`), and each attempt is
  capped at 10 s and 2 MiB. A tile may have three attempts with backoff; this is not
  a ten-second bound for the whole render. Spec checks do not fetch tiles or write
  caches. Request URLs and provider keys are omitted from fetch-error reports.
- For PNG export, starts your locally installed Chrome, Edge, Brave or
  Chromium in headless mode with a temporary profile.
- The generated HTML makes no network requests.
