// Raster basemaps.
//
// The vector basemap ships Natural Earth at 1:50m — enough for a country at page
// width, coarse for a city. This module adds an optional raster layer: fetch XYZ
// tiles for whatever the frame actually shows, project their corners through the
// same projection the data uses, and place them as <image> elements underneath it.
//
// Mercator only. Tiles are Web Mercator squares; only a conformal, axis-aligned
// projection maps a tile's corners to the corners of a rectangle, so anything else
// would shear the imagery. render.mjs forces the projection when a basemap is asked
// for, and says so in the report.
//
// No dependencies, matching the CLI: tiles are embedded as data URIs so the HTML
// and SVG stay self-contained, and they are cached on disk so repeat renders are free.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Tile sources. `url` takes {z}/{x}/{y}; attribution is printed in the footer.
 *  Keyless sources are listed first: the CARTO ones answer HTTP 200 with a
 *  watermarked "API KEY REQUIRED" tile when no key is supplied, which fails
 *  silently and is worse than an error, so they say so here. */
export const PRESETS = {
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  },
  "osm-hot": {
    url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors, tiles by HOT",
    maxZoom: 19,
  },
  "carto-light": {
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20,
    requiresKey: true,
  },
  "carto-dark": {
    url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20,
    requiresKey: true,
  },
  "carto-voyager": {
    url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20,
    requiresKey: true,
  },
};

/** A dark basemap from the keyless OSM tiles, for dark themes. */
export const DARK_FILTER = "invert(1) hue-rotate(180deg) brightness(0.9) saturate(0.55)";

const UA = "map-design/0.1 (agent skill; +https://github.com/incline-ltd/map-design)";
const MAX_LAT = 85.05112878;

/**
 * Normalise spec.basemap.
 *   true | "osm"        -> that preset
 *   { preset: "dark" }  -> a preset plus overrides
 * Returns null when no basemap was asked for.
 */
export function resolveBasemap(basemap) {
  if (!basemap) return null;
  if (basemap === true) basemap = "osm";
  const cfg = typeof basemap === "string" ? { preset: basemap } : { ...basemap };
  const preset = PRESETS[cfg.preset ?? "osm"] ?? PRESETS.osm;
  return {
    url: cfg.url ?? preset.url,
    attribution: cfg.attribution ?? preset.attribution,
    maxZoom: cfg.maxZoom ?? preset.maxZoom ?? 19,
    maxTiles: cfg.maxTiles ?? 144,
    // A preset that needs a key but was not overridden with a keyed url will serve
    // watermarked tiles at HTTP 200. Say so rather than ship a broken basemap.
    requiresKey: !cfg.url && preset.requiresKey === true,
    presetName: cfg.preset ?? "osm",
    zoom: cfg.zoom ?? null,
    opacity: cfg.opacity ?? 1,
    filter: cfg.filter ?? null,
    cache: cfg.cache !== false,
  };
}

/** Standard slippy-map tile index for a coordinate. */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/** Inverse: north-west corner of tile x/y in degrees. */
export function tileToLonLat(x, y, z) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

/** Tile range covering a lon/lat box at one zoom. */
export function tileRange(box, z) {
  const nw = lonLatToTile(box.west, box.north, z);
  const se = lonLatToTile(box.east, box.south, z);
  return {
    x0: Math.max(0, Math.floor(nw.x)),
    x1: Math.min(2 ** z - 1, Math.floor(se.x)),
    y0: Math.max(0, Math.floor(nw.y)),
    y1: Math.min(2 ** z - 1, Math.floor(se.y)),
  };
}

/** Highest zoom that fits the tile budget.
 *
 *  The budget is the binding constraint: quality only improves with zoom, so the
 *  right answer is always the highest zoom the budget allows. A tile can still end
 *  up stretched beyond its native 256 px when the budget is small — that is a
 *  hint to raise `maxTiles`, not a reason to render a world tile for a country,
 *  so it is returned as `stretch` for the report to mention. */
export function chooseZoom(box, { maxZoom = 19, maxTiles = 144, projection = null } = {}) {
  for (let z = maxZoom; z >= 0; z--) {
    const r = tileRange(box, z);
    const count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (count > maxTiles) continue;
    let stretch = null;
    if (projection?.invert) {
      const a = projection([tileToLonLat(r.x0, r.y0, z).lon, tileToLonLat(r.x0, r.y0, z).lat]);
      const b = projection([tileToLonLat(r.x0 + 1, r.y0 + 1, z).lon, tileToLonLat(r.x0 + 1, r.y0 + 1, z).lat]);
      if (a && b) stretch = Math.abs(b[0] - a[0]) / 256;
    }
    return { zoom: z, range: r, count, stretch };
  }
  return { zoom: 0, range: tileRange(box, 0), count: 1, stretch: null };
}

function cacheDir() {
  if (process.env.MAP_DESIGN_TILE_CACHE) return process.env.MAP_DESIGN_TILE_CACHE;
  const xdg = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(xdg, "map-design", "tiles");
}

/** Fetch one tile as a data URI, using the on-disk cache. Never throws.
 *  Public tile servers answer 429/5xx under load; a missing tile leaves a hole in
 *  the map, so retry a few times with backoff before giving up. */
export async function defaultFetchTile(url, { cache = true } = {}) {
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(cacheDir(), `${key}.png`);
  if (cache) {
    try {
      const buf = await fs.readFile(file);
      if (buf.length > 64) return { data: buf.toString("base64"), cached: true };
    } catch {
      /* not cached yet */
    }
  }
  let lastError;
  for (const wait of [0, 500, 1500]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "image/png,image/*" } });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status === 404) break; // genuinely absent, don't hammer
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 64) {
        lastError = "empty tile";
        continue;
      }
      if (cache) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, buf);
      }
      return { data: buf.toString("base64"), cached: false };
    } catch (err) {
      lastError = String(err?.message ?? err);
    }
  }
  return { error: lastError };
}

const num = (v) => (Math.round(v * 100) / 100).toString();

/**
 * Build the raster layer for a framed map.
 *
 * `projection` is the d3 projection already fitted to the map area, `rect` is the
 * clipped pixel rect. Returns image markup (already positioned) plus a small report.
 */
export async function rasterBasemap({ spec, projection, rect, fetchTile = defaultFetchTile }) {
  const cfg = resolveBasemap(spec.basemap);
  if (!cfg) return null;
  if (typeof projection?.invert !== "function") {
    return { images: [], attribution: cfg.attribution, error: "projection has no invert()" };
  }

  // What part of the world does the frame actually show?
  const corners = [
    projection.invert([rect[0][0], rect[0][1]]),
    projection.invert([rect[1][0], rect[0][1]]),
    projection.invert([rect[0][0], rect[1][1]]),
    projection.invert([rect[1][0], rect[1][1]]),
  ].filter((c) => c && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (corners.length < 4) return { images: [], attribution: cfg.attribution, error: "cannot invert the frame" };

  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  const box = {
    west: Math.max(-180, Math.min(...lons)),
    east: Math.min(180, Math.max(...lons)),
    south: Math.max(-MAX_LAT, Math.min(...lats)),
    north: Math.min(MAX_LAT, Math.max(...lats)),
  };
  if (!(box.east > box.west) || !(box.north > box.south)) {
    return { images: [], attribution: cfg.attribution, error: "empty frame" };
  }

  const chosen = cfg.zoom ? { zoom: cfg.zoom, range: tileRange(box, cfg.zoom) } : chooseZoom(box, { ...cfg, projection });
  const { zoom, range } = chosen;
  if (process.env.MAP_DESIGN_DEBUG_TILES) {
    const a = projection([tileToLonLat(range.x0, range.y0, zoom).lon, tileToLonLat(range.x0, range.y0, zoom).lat]);
    const b = projection([tileToLonLat(range.x0 + 1, range.y0 + 1, zoom).lon, tileToLonLat(range.x0 + 1, range.y0 + 1, zoom).lat]);
    console.error(
      `[tiles] box=${JSON.stringify(box)} rect=${JSON.stringify(rect)} ` +
        `maxTiles=${cfg.maxTiles} maxZoom=${cfg.maxZoom} -> z${zoom} ` +
        `x${range.x0}-${range.x1} y${range.y0}-${range.y1} ` +
        `tilePx=${a && b ? Math.abs(b[0] - a[0]).toFixed(0) : "?"}`
    );
  }

  const jobs = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) jobs.push({ x, y });
  }

  // bounded concurrency — polite to the tile server
  const results = new Array(jobs.length);
  const LIMIT = 4;   // polite: public tile servers throttle bursts
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const i = cursor++;
      const { x, y } = jobs[i];
      const url = cfg.url.replace("{z}", zoom).replace("{x}", x).replace("{y}", y);
      results[i] = { ...(await fetchTile(url, { cache: cfg.cache })), x, y };
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, jobs.length) }, worker));

  const images = [];
  let delivered = 0;
  const failures = [];
  const filter = cfg.filter ?? "none";
  const style = `opacity:${cfg.opacity}` + (filter !== "none" ? `;filter:${filter}` : "");
  for (const r of results) {
    if (!r?.data) {
      if (r?.error) failures.push(`${r.x}/${r.y}: ${r.error}`);
      continue;
    }
    const nw = tileToLonLat(r.x, r.y, zoom);
    const se = tileToLonLat(r.x + 1, r.y + 1, zoom);
    const a = projection([nw.lon, nw.lat]);
    const b = projection([se.lon, se.lat]);
    if (!a || !b) continue;
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    // a hair of overlap stops hairline seams between neighbours
    images.push(
      `<image x="${num(x0)}" y="${num(y0)}" width="${num(x1 - x0 + 0.5)}" height="${num(y1 - y0 + 0.5)}" ` +
        `preserveAspectRatio="none" href="data:image/png;base64,${r.data}"/>`
    );
    delivered += 1;
  }

  return {
    group: images.length ? `<g class="basemap-raster" style="${style}">${images.join("")}</g>` : "",
    attribution: cfg.attribution,
    zoom,
    stretch: chosen.stretch ?? null,
    tiles: delivered,
    requested: jobs.length,
    failures,
    warning: cfg.requiresKey
      ? `basemap preset "${cfg.presetName}" needs an API key and returns watermarked tiles without one — pass a keyed url or use "osm"`
      : null,
    error: images.length ? null : failures[0] ?? "no tiles",
  };
}
