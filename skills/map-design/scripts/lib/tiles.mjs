// Raster basemaps.
//
// The vector basemap ships Natural Earth at 1:50m — enough for a country at page
// width, coarse for a city. This module adds an optional raster layer: fetch XYZ
// tiles for whatever the frame actually shows and place them on the same fitted
// Mercator scale as the data, as <image> elements underneath it.
//
// Mercator only. Tiles are Web Mercator squares; only a conformal, axis-aligned
// projection maps a tile's corners to the corners of a rectangle, so anything else
// would shear the imagery. render.mjs forces the projection when a basemap is asked
// for, and says so in the report.
//
// No dependencies, matching the CLI: tiles are embedded as data URIs so the HTML
// and SVG stay self-contained. Provider-permitted disk caches avoid repeat requests.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SpecError } from "./errors.mjs";

/** A dark basemap from the keyless OSM tiles, for dark themes. */
export const DARK_FILTER = "invert(1) hue-rotate(180deg) brightness(0.9) saturate(0.55)";

/** Tile sources. `url` takes {z}/{x}/{y}; attribution is printed in the footer.
 *  Keyless sources are listed first. CARTO requests require a keyed URL and
 *  are rejected before fetching when that key is missing.
 *  `osm-dark` is internal: the standard OSM tiles recoloured with DARK_FILTER,
 *  which is what the documented `dark` alias resolves to. */
export const PRESETS = {
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
    maxZoom: 19,
  },
  "osm-hot": {
    url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors, style by HOT, tiles by OpenStreetMap France",
    attributionUrl: "https://www.openstreetmap.org/copyright",
    maxZoom: 19,
  },
  "osm-dark": {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
    maxZoom: 19,
    filter: DARK_FILTER,
  },
  "carto-light": {
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    attributionUrl: "https://carto.com/attribution/",
    maxZoom: 20,
    requiresKey: true,
  },
  "carto-dark": {
    url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    attributionUrl: "https://carto.com/attribution/",
    maxZoom: 20,
    requiresKey: true,
  },
  "carto-voyager": {
    url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    attributionUrl: "https://carto.com/attribution/",
    maxZoom: 20,
    requiresKey: true,
  },
};

/** Documented short names. `light` is the standard OSM style; `dark` is the
 *  keyless inverted-OSM recipe from SKILL.md. `voyager` has no keyless
 *  equivalent, so it maps to the CARTO preset and keeps its API-key requirement. */
const ALIASES = { light: "osm", dark: "osm-dark", voyager: "carto-voyager" };

/** Names a spec may use, for error messages (internal presets stay hidden). */
const PUBLIC_PRESETS = ["osm", "osm-hot", "light", "dark", "voyager", "carto-light", "carto-dark", "carto-voyager"];

const UA = "map-design/0.1 (+https://github.com/ashishkaloge/map-design)";
const MAX_LAT = 85.05112878;

// Fetch bounds: a 256 px PNG tile is tens of KB, so 2 MB is generous, and a
// public tile server that has not answered in 10 s is not going to.
const FETCH_TIMEOUT_MS = 10_000;
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Absolute ceilings for the numeric knobs. Presets cap zoom lower (19/20);
// 25 is the practical slippy-map ceiling. The tile budget is what keeps a
// render polite, so it gets a hard ceiling too, whatever the spec asks for.
const MAX_ZOOM_ABS = 25;
const MAX_TILES_ABS = 4096;

/** Plain CSS filter functions with one numeric argument, e.g.
 *  "saturate(0.6) brightness(0.72)". No url(), no drop-shadow, nothing that
 *  could carry markup into the SVG attribute the filter lands in. */
function safeFilter(value) {
  const functions = [...value.matchAll(/([a-z-]+)\(\s*([^()]*)\s*\)/gi)];
  if (!functions.length || value.replace(/([a-z-]+)\(\s*([^()]*)\s*\)/gi, "").trim()) return false;
  return functions.every(([, name, argument]) => {
    const arg = argument.trim();
    if (["brightness", "contrast", "grayscale", "invert", "opacity", "saturate", "sepia"].includes(name.toLowerCase())) {
      return /^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(arg);
    }
    if (name.toLowerCase() === "blur") return /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)px)$/.test(arg);
    if (name.toLowerCase() === "hue-rotate") return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|rad|turn)$/.test(arg);
    return false;
  });
}

function providerFor(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ""); } catch { return "custom"; }
  if (host === "tile.openstreetmap.org") return "osm";
  if (host === "basemaps.cartocdn.com" || /^[abcd]\.basemaps\.cartocdn\.com$/.test(host)) return "carto";
  if (host === "tile.openstreetmap.fr" || host.endsWith(".tile.openstreetmap.fr")) return "osm-fr";
  return "custom";
}

function cartoKeyError(url) {
  if (providerFor(url) !== "carto") return null;
  const keys = new URL(url).searchParams.getAll("key");
  return keys.length === 1 && keys[0].trim()
    ? null
    : "CARTO basemaps require your own API key: provide basemap.url with one nonempty key query parameter, or choose osm.";
}

/** Check the PNG signature and header before treating downloaded/cache bytes as
 *  an image. This is format detection, not a replacement for a PNG decoder. */
function isPng(buf) {
  return buf.length >= 33
    && buf.subarray(0, 8).equals(PNG_SIGNATURE)
    && buf.readUInt32BE(8) === 13
    && buf.toString("ascii", 12, 16) === "IHDR"
    && buf.readUInt32BE(16) > 0
    && buf.readUInt32BE(20) > 0;
}

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
  const presetName = Object.hasOwn(ALIASES, askedName) ? ALIASES[askedName] : askedName;
  const preset = Object.hasOwn(PRESETS, presetName) ? PRESETS[presetName] : null;
  if (!preset) {
    throw new SpecError(
      `unknown basemap preset ${JSON.stringify(askedName)}. Use one of: ${PUBLIC_PRESETS.join(", ")} — or pass { url, attribution } for your own server.`
    );
  }

  if (cfg.url != null) {
    if (typeof cfg.url !== "string" || !/^https?:\/\//i.test(cfg.url)) {
      throw new SpecError("basemap.url must be an http(s) URL with {z}/{x}/{y} placeholders.");
    }
    for (const p of ["{z}", "{x}", "{y}"]) {
      if (!cfg.url.includes(p)) throw new SpecError(`basemap.url must contain the ${p} placeholder.`);
    }
    try {
      const url = new URL(cfg.url);
      if (url.username || url.password) throw new Error("credentials");
    } catch {
      throw new SpecError("basemap.url must be a valid http(s) URL without embedded login credentials.");
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
  if (cfg.filter != null && (typeof cfg.filter !== "string" || !safeFilter(cfg.filter.trim()))) {
    throw new SpecError(
      `basemap.filter must be plain CSS filter functions like "saturate(0.6) brightness(0.72)" — no url(), no drop-shadow — got ${JSON.stringify(cfg.filter)}.`
    );
  }
  if (cfg.cache != null && typeof cfg.cache !== "boolean") {
    throw new SpecError(`basemap.cache must be true or false, got ${JSON.stringify(cfg.cache)}.`);
  }
  const url = cfg.url ?? preset.url;
  const provider = providerFor(url);
  const keyError = cartoKeyError(url);
  if (keyError) throw new SpecError(keyError);
  if (provider === "osm" && cfg.cache === false) {
    throw new SpecError("OpenStreetMap's standard tile service requires caching; keep basemap.cache enabled or use another provider.");
  }
  if (provider === "carto") {
    warnings.push("CARTO tiles are not cached on disk; its terms prohibit server-side caching and limit end-user retention");
  }
  const knownPreset = !cfg.url || cfg.preset != null;

  return {
    url,
    attribution: cfg.attribution ?? (knownPreset ? preset.attribution : ""),
    attributionUrls: knownPreset
      ? [...new Set(["https://www.openstreetmap.org/copyright", preset.attributionUrl])]
      : [],
    maxZoom,
    maxTiles,
    // CARTO's key requirement has already been checked against the actual host.
    requiresKey: provider === "carto",
    presetName: askedName,
    zoom,
    opacity: cfg.opacity ?? 1,
    filter: cfg.filter ?? preset.filter ?? null,
    cache: provider !== "carto" && cfg.cache !== false,
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

/** Tile range covering an unwrapped lon/lat box. X can cross the world edge;
 *  only the request index is wrapped, while placement keeps the original X. */
export function tileRange(box, z) {
  const nw = lonLatToTile(box.west, box.north, z);
  const se = lonLatToTile(box.east, box.south, z);
  return {
    x0: Math.floor(nw.x),
    x1: Math.max(Math.floor(nw.x), Math.ceil(se.x) - 1),
    y0: Math.max(0, Math.floor(nw.y)),
    y1: Math.min(2 ** z - 1, Math.max(0, Math.ceil(se.y) - 1)),
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
    const count = tileCount(r, z);
    if (count > maxTiles) continue;
    let stretch = null;
    if (projection?.scale) stretch = (2 * Math.PI * projection.scale()) / (2 ** z * 256);
    return { zoom: z, range: r, count, stretch };
  }
  return { zoom: 0, range: tileRange(box, 0), count: 1, stretch: null };
}

function tileCount(range, zoom) {
  // A world-spanning view can show the same edge tile twice. Fetch it once.
  return Math.min(2 ** zoom, range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
}

const wrapX = (x, zoom) => ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom;

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
  const keyError = cartoKeyError(url);
  if (keyError) return { error: keyError };
  // Match by actual destination, including a custom keyed CARTO URL.
  if (providerFor(url) === "carto") cache = false;
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(cacheDir(), `${key}.png`);
  if (cache) {
    try {
      const stat = await fs.stat(file);
      if (stat.size >= 33 && stat.size <= maxBytes && Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
        const buf = await fs.readFile(file);
        if (buf.length <= maxBytes && isPng(buf)) return { data: buf.toString("base64"), cached: true };
      }
    } catch {
      /* not cached yet */
    }
  }
  let lastError;
  for (const wait of [0, 500, 1500]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "image/png" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        await res.body?.cancel().catch(() => {});
        if (res.status === 404) break; // genuinely absent, don't hammer
        continue;
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        lastError = `tile over the ${maxBytes}-byte cap`;
        await res.body?.cancel().catch(() => {});
        break; // it will not shrink on a retry
      }
      if (res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/png") {
        lastError = "tile response must have content-type image/png";
        await res.body?.cancel().catch(() => {});
        break;
      }
      const buf = await readCapped(res, maxBytes);
      if (!buf) {
        lastError = `tile over the ${maxBytes}-byte cap`;
        break;
      }
      if (!isPng(buf)) {
        lastError = "tile response is not a PNG image";
        break;
      }
      if (cache) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, buf);
      }
      return { data: buf.toString("base64"), cached: false };
    } catch (err) {
      // Fetch errors can include the request URL, including a provider key.
      lastError = err?.name === "TimeoutError" ? `timeout after ${timeoutMs}ms` : "tile request failed";
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
  if (typeof projection?.invert !== "function" || typeof projection?.scale !== "function" || typeof projection?.rotate !== "function") {
    return { images: [], attribution: cfg.attribution, warnings, error: "projection is not a fitted Mercator projection" };
  }

  // Mercator has a continuous square tile lattice. Inverting the left/right
  // corners loses full turns: a world frame appears to be a tiny longitude
  // strip, while a dateline frame appears to span almost the entire world.
  // Recover longitude from pixel distance instead, and keep unwrapped X
  // indices for placement. Only request indices wrap at +/-180 degrees.
  const centerLon = -projection.rotate()[0];
  const center = projection([centerLon, 0]);
  const worldSize = 2 * Math.PI * projection.scale();
  const left = Math.max(rect[0][0], center[0] - worldSize / 2);
  const right = Math.min(rect[1][0], center[0] + worldSize / 2);
  const top = Math.max(rect[0][1], center[1] - worldSize / 2);
  const bottom = Math.min(rect[1][1], center[1] + worldSize / 2);
  const north = projection.invert([center[0], top])?.[1];
  const south = projection.invert([center[0], bottom])?.[1];
  if (![...center, worldSize, north, south].every(Number.isFinite) || worldSize <= 0) {
    return { images: [], attribution: cfg.attribution, warnings, error: "cannot invert the frame" };
  }
  const worldLeft = center[0] - ((centerLon + 180) / 360) * worldSize;
  const worldTop = center[1] - worldSize / 2;
  const box = {
    west: centerLon + ((left - center[0]) / worldSize) * 360,
    east: centerLon + ((right - center[0]) / worldSize) * 360,
    south: Math.max(-MAX_LAT, south),
    north: Math.min(MAX_LAT, north),
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
    const count = tileCount(range, cfg.zoom);
    if (count > cfg.maxTiles) {
      warnings.push(
        `zoom ${cfg.zoom} would need ${count} tiles here — over the maxTiles budget (${cfg.maxTiles}); chose a zoom that fits the budget instead`
      );
      chosen = chooseZoom(box, { ...cfg, projection });
    } else {
      chosen = { zoom: cfg.zoom, range, count, stretch: worldSize / (2 ** cfg.zoom * 256) };
    }
  } else {
    chosen = chooseZoom(box, { ...cfg, projection });
  }
  const { zoom, range } = chosen;
  const tileSize = worldSize / 2 ** zoom;
  if (process.env.MAP_DESIGN_DEBUG_TILES) {
    console.error(
      `[tiles] box=${JSON.stringify(box)} rect=${JSON.stringify(rect)} ` +
        `maxTiles=${cfg.maxTiles} maxZoom=${cfg.maxZoom} -> z${zoom} ` +
        `x${range.x0}-${range.x1} y${range.y0}-${range.y1} ` +
        `tilePx=${tileSize.toFixed(0)}`
    );
  }

  const byTile = new Map();
  for (let x = range.x0; x <= range.x1; x++) {
    const requestX = wrapX(x, zoom);
    for (let y = range.y0; y <= range.y1; y++) {
      const key = `${requestX}/${y}`;
      if (!byTile.has(key)) byTile.set(key, { x: requestX, y, placements: [] });
      byTile.get(key).placements.push(x);
    }
  }
  const jobs = [...byTile.values()];

  // bounded concurrency — polite to the tile server
  const results = new Array(jobs.length);
  const LIMIT = 4;   // polite: public tile servers throttle bursts
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const i = cursor++;
      const { x, y, placements } = jobs[i];
      const url = cfg.url.replace("{z}", zoom).replace("{x}", x).replace("{y}", y);
      results[i] = { ...(await fetchTile(url, { cache: cfg.cache })), x, y, placements };
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
    for (const x of r.placements) {
      // Linear placement never projects a seam-crossing tile into a huge
      // rectangle. Duplicate edge placements reuse the same downloaded bytes.
      const x0 = worldLeft + x * tileSize;
      const y0 = worldTop + r.y * tileSize;
      images.push(
        `<image x="${num(x0)}" y="${num(y0)}" width="${num(tileSize + 0.5)}" height="${num(tileSize + 0.5)}" ` +
          `preserveAspectRatio="none" href="data:image/png;base64,${r.data}"/>`
      );
    }
    delivered += 1;
  }

  // Edge placements intentionally extend through the longitude seam. Clip the
  // imagery and filter effects to one fitted Mercator world, not just the page.
  const clipId = "basemap-raster-clip";
  const clip = `<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${num(left)}" y="${num(top)}" width="${num(right - left)}" height="${num(bottom - top)}"/></clipPath></defs>`;
  return {
    group: images.length ? `${clip}<g class="basemap-raster" style="${style}" clip-path="url(#${clipId})">${images.join("")}</g>` : "",
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
