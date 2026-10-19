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
import { SpecError } from "./errors.mjs";

/** A dark basemap from the keyless OSM tiles, for dark themes. */
export const DARK_FILTER = "invert(1) hue-rotate(180deg) brightness(0.9) saturate(0.55)";

/** Tile sources. `url` takes {z}/{x}/{y}; attribution is printed in the footer.
 *  Keyless sources are listed first: the CARTO ones answer HTTP 200 with a
 *  watermarked "API KEY REQUIRED" tile when no key is supplied, which fails
 *  silently and is worse than an error, so they say so here.
 *  `osm-dark` is internal: the standard OSM tiles recoloured with DARK_FILTER,
 *  which is what the documented `dark` alias resolves to. */
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
  "osm-dark": {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
    filter: DARK_FILTER,
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

/** Documented short names. `light` is the standard OSM style; `dark` is the
 *  keyless inverted-OSM recipe from SKILL.md. `voyager` has no keyless
 *  equivalent, so it maps to the CARTO preset and keeps its API-key warning. */
const ALIASES = { light: "osm", dark: "osm-dark", voyager: "carto-voyager" };

/** Names a spec may use, for error messages (internal presets stay hidden). */
const PUBLIC_PRESETS = ["osm", "osm-hot", "light", "dark", "voyager", "carto-light", "carto-dark", "carto-voyager"];

const UA = "map-design/0.1 (agent skill; +https://github.com/incline-ltd/map-design)";
const MAX_LAT = 85.05112878;

// Fetch bounds: a 256 px PNG tile is tens of KB, so 2 MB is generous, and a
// public tile server that has not answered in 10 s is not going to.
const FETCH_TIMEOUT_MS = 10_000;
const MAX_TILE_BYTES = 2 * 1024 * 1024;

// Absolute ceilings for the numeric knobs. Presets cap zoom lower (19/20);
// 25 is the practical slippy-map ceiling. The tile budget is what keeps a
// render polite, so it gets a hard ceiling too, whatever the spec asks for.
const MAX_ZOOM_ABS = 25;
const MAX_TILES_ABS = 4096;

/** Plain CSS filter functions with one numeric argument, e.g.
 *  "saturate(0.6) brightness(0.72)". No url(), no drop-shadow, nothing that
 *  could carry markup into the SVG attribute the filter lands in. */
const SAFE_FILTER = /^([a-z-]+\(\s*[\d.]+\s*(%|deg|px|rad|turn)?\s*\)\s*)+$/i;

/** Bounded integer knob: present-but-wrong is a spec error, not a surprise. */
function boundedInt(value, name, lo, hi) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < lo || value > hi) {
    throw new SpecError(`basemap.${name} must be an integer between ${lo} and ${hi}, got ${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * Normalise spec.basemap.
 *   true | "osm"        -> that preset
 *   { preset: "dark" }  -> a preset plus overrides
 * Invalid values (unknown preset, out-of-range zoom or budgets, an opacity
 * outside 0-1, a filter that is not plain CSS filter functions, a url without
 * {z}/{x}/{y}) throw a SpecError. Non-fatal adjustments (a zoom clamped to the
 * preset's maxZoom, a custom url without attribution) come back in `warnings`.
 * Returns null when no basemap was asked for.
 */
export function resolveBasemap(basemap) {
  if (basemap == null || basemap === false) return null;
  if (basemap === true) basemap = "osm";
  if (typeof basemap !== "string" && (typeof basemap !== "object" || Array.isArray(basemap))) {
    throw new SpecError(`basemap must be true, a preset name, or an object, got ${JSON.stringify(basemap)}.`);
  }
  const cfg = typeof basemap === "string" ? { preset: basemap } : { ...basemap };
  const warnings = [];

  if (cfg.preset != null && typeof cfg.preset !== "string") {
    throw new SpecError(`basemap.preset must be a string, got ${JSON.stringify(cfg.preset)}.`);
  }
  const askedName = cfg.preset ?? "osm";
  const presetName = ALIASES[askedName] ?? askedName;
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new SpecError(
      `unknown basemap preset ${JSON.stringify(askedName)}. Use one of: ${PUBLIC_PRESETS.join(", ")} — or pass { url, attribution } for your own server.`
    );
  }

  if (cfg.url != null) {
    if (typeof cfg.url !== "string" || !/^https?:\/\//i.test(cfg.url)) {
      throw new SpecError(`basemap.url must be an http(s) URL with {z}/{x}/{y} placeholders, got ${JSON.stringify(cfg.url)}.`);
    }
    for (const p of ["{z}", "{x}", "{y}"]) {
      if (!cfg.url.includes(p)) throw new SpecError(`basemap.url must contain the ${p} placeholder, got ${JSON.stringify(cfg.url)}.`);
    }
  }
  if (cfg.attribution != null && typeof cfg.attribution !== "string") {
    throw new SpecError(`basemap.attribution must be a string, got ${JSON.stringify(cfg.attribution)}.`);
  }
  if (cfg.url && !cfg.attribution) {
    warnings.push("custom basemap url without attribution — most tile providers require a visible credit");
  }

  const maxTiles = boundedInt(cfg.maxTiles, "maxTiles", 1, MAX_TILES_ABS) ?? 144;
  const maxZoom = boundedInt(cfg.maxZoom, "maxZoom", 0, MAX_ZOOM_ABS) ?? preset.maxZoom ?? 19;
  let zoom = boundedInt(cfg.zoom, "zoom", 0, MAX_ZOOM_ABS);
  if (zoom != null && zoom > maxZoom) {
    warnings.push(`zoom ${zoom} is above this preset's maxZoom ${maxZoom} — clamped to ${maxZoom}`);
    zoom = maxZoom;
  }

  if (cfg.opacity != null && (typeof cfg.opacity !== "number" || !Number.isFinite(cfg.opacity) || cfg.opacity < 0 || cfg.opacity > 1)) {
    throw new SpecError(`basemap.opacity must be a number between 0 and 1, got ${JSON.stringify(cfg.opacity)}.`);
  }
  if (cfg.filter != null && (typeof cfg.filter !== "string" || !SAFE_FILTER.test(cfg.filter.trim()))) {
    throw new SpecError(
      `basemap.filter must be plain CSS filter functions like "saturate(0.6) brightness(0.72)" — no url(), no drop-shadow — got ${JSON.stringify(cfg.filter)}.`
    );
  }
  if (cfg.cache != null && typeof cfg.cache !== "boolean") {
    throw new SpecError(`basemap.cache must be true or false, got ${JSON.stringify(cfg.cache)}.`);
  }

  return {
    url: cfg.url ?? preset.url,
    attribution: cfg.attribution ?? preset.attribution,
    maxZoom,
    maxTiles,
    // A preset that needs a key but was not overridden with a keyed url will serve
    // watermarked tiles at HTTP 200. Say so rather than ship a broken basemap.
    requiresKey: !cfg.url && preset.requiresKey === true,
    presetName: askedName,
    zoom,
    opacity: cfg.opacity ?? 1,
    filter: cfg.filter ?? preset.filter ?? null,
    cache: cfg.cache !== false,
    warnings,
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

/** Read a response body, giving up past maxBytes. Returns null when oversized. */
async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Fetch one tile as a data URI, using the on-disk cache. Never throws.
 *  Bounded: each attempt gives up after `timeoutMs`, and a body larger than
 *  `maxBytes` is rejected. Public tile servers answer 429/5xx under load; a
 *  missing tile leaves a hole in the map, so retry a few times with backoff
 *  before giving up. */
export async function defaultFetchTile(url, { cache = true, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_TILE_BYTES } = {}) {
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(cacheDir(), `${key}.png`);
  if (cache) {
    try {
      const buf = await fs.readFile(file);
      if (buf.length > 64 && buf.length <= maxBytes) return { data: buf.toString("base64"), cached: true };
    } catch {
      /* not cached yet */
    }
  }
  let lastError;
  for (const wait of [0, 500, 1500]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "image/png,image/*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status === 404) break; // genuinely absent, don't hammer
        continue;
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        lastError = `tile over the ${maxBytes}-byte cap`;
        break; // it will not shrink on a retry
      }
      const buf = await readCapped(res, maxBytes);
      if (!buf) {
        lastError = `tile over the ${maxBytes}-byte cap`;
        break;
      }
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
      lastError = err?.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : String(err?.message ?? err);
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
  const warnings = [...cfg.warnings];
  if (cfg.requiresKey) {
    warnings.push(
      `preset "${cfg.presetName}" needs an API key and returns watermarked tiles without one — pass a keyed url or use "osm"`
    );
  }
  if (typeof projection?.invert !== "function") {
    return { images: [], attribution: cfg.attribution, warnings, error: "projection has no invert()" };
  }

  // What part of the world does the frame actually show?
  const corners = [
    projection.invert([rect[0][0], rect[0][1]]),
    projection.invert([rect[1][0], rect[0][1]]),
    projection.invert([rect[0][0], rect[1][1]]),
    projection.invert([rect[1][0], rect[1][1]]),
  ].filter((c) => c && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (corners.length < 4) return { images: [], attribution: cfg.attribution, warnings, error: "cannot invert the frame" };

  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  const box = {
    west: Math.max(-180, Math.min(...lons)),
    east: Math.min(180, Math.max(...lons)),
    south: Math.max(-MAX_LAT, Math.min(...lats)),
    north: Math.min(MAX_LAT, Math.max(...lats)),
  };
  if (!(box.east > box.west) || !(box.north > box.south)) {
    return { images: [], attribution: cfg.attribution, warnings, error: "empty frame" };
  }

  // The tile budget always wins. An explicit zoom that would blow it is a spec
  // mistake, not a licence to fetch thousands of tiles: warn and pick the
  // highest zoom the budget allows, as if no zoom had been given.
  let chosen;
  if (cfg.zoom != null) {
    const range = tileRange(box, cfg.zoom);
    const count = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
    if (count > cfg.maxTiles) {
      warnings.push(
        `zoom ${cfg.zoom} would need ${count} tiles here — over the maxTiles budget (${cfg.maxTiles}); chose a zoom that fits the budget instead`
      );
      chosen = chooseZoom(box, { ...cfg, projection });
    } else {
      chosen = { zoom: cfg.zoom, range, count, stretch: null };
    }
  } else {
    chosen = chooseZoom(box, { ...cfg, projection });
  }
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
  // Both values are validated in resolveBasemap: opacity is a number in 0-1 and
  // filter is plain CSS filter functions, so they serialize safely into the style.
  const style = `opacity:${num(cfg.opacity)}` + (cfg.filter ? `;filter:${cfg.filter.trim()}` : "");
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
    warnings,
    error: images.length ? null : failures[0] ?? "no tiles",
  };
}
