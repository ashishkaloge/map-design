// OpenStreetMap features from vector tiles in the OpenMapTiles schema, by default
// the public OpenFreeMap instance (https://openfreemap.org). Posters and street
// basemaps use them instead of the busy public Overpass API.
//
// OpenFreeMap's terms allow downloads from apps of at most 3,000 tiles or 50 MB,
// with at most 4 parallel requests and a User-Agent that identifies the app
// (https://openfreemap.org/tos/). Every limit below is enforced before or while
// downloading, and tiles are cached on disk so re-renders stay offline.
//
// Geometry is clipped to each tile's own square, so pieces from neighbouring
// tiles meet edge to edge instead of overlapping in the tile buffer: polygons can
// share one even-odd path and lines are never drawn twice.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync } from "node:zlib";
import { Pbf, VectorTile, classifyRings } from "../vendor/vtile.mjs";
import { SpecError } from "./errors.mjs";
import { tileRange } from "./tiles.mjs";

export const OPENFREEMAP = "https://tiles.openfreemap.org/planet";
export const VECTOR_ATTRIBUTION = "© OpenMapTiles.org © OpenStreetMap contributors";
export const LIMITS = { tiles: 3000, bytes: 50_000_000, parallel: 4 };
const UA = "map-design/0.1 (+https://github.com/ashishkaloge/map-design)";
const TIMEOUT_MS = 30_000;
const MAX_TILE_BYTES = 4 * 1024 * 1024;
const MAX_DECODED_BYTES = MAX_TILE_BYTES * 4;
const MAX_TILEJSON_BYTES = 1024 * 1024;
const TILEJSON_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** TileJSON of the vector source. MAP_DESIGN_TILEJSON points at another
 *  OpenMapTiles-schema source, such as a self-hosted one. */
export function tilejsonUrl() {
  return process.env.MAP_DESIGN_TILEJSON || OPENFREEMAP;
}

function cacheRoot() {
  const base = process.env.MAP_DESIGN_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "map-design");
  return join(base, "vector");
}

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);

async function get(url, { accept, maxBytes, signal, onBytes, capError }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS);
  try {
    signal?.throwIfAborted();
    const res = await fetch(url, { headers: { "user-agent": UA, accept }, signal: controller.signal, redirect: "error" });
    if (res.status === 204 || res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, buf: Buffer.alloc(0) };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, buf: null };
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw capError?.() ?? new Error(`response over the ${maxBytes}-byte cap`);
    }
    const chunks = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) return { status: res.status, buf: Buffer.alloc(0) };
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      onBytes?.(value.length);
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw capError?.() ?? new Error(`response over the ${maxBytes}-byte cap`);
      }
      chunks.push(Buffer.from(value));
    }
    return { status: res.status, buf: Buffer.concat(chunks) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

/** Fetch with retries for busy servers (429, 5xx) and dropped connections. */
async function getWithRetry(url, opts) {
  let last;
  for (const wait of [0, 1000, 3000]) {
    opts.signal?.throwIfAborted();
    if (wait) await delay(wait, undefined, { signal: opts.signal });
    const reservation = await opts.budget?.reserve(opts.signal);
    try {
      const r = await get(url, { ...opts, ...reservation });
      if (r.buf) return r.buf;
      last = new Error(`HTTP ${r.status}`);
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      if (opts.signal?.aborted) throw opts.signal.reason;
      if (e instanceof SpecError) throw e;
      // Fetch/JSON errors can include a configured URL, credentials or response
      // text. Only our bounded diagnostics are safe to expose in reports.
      last = /^(response over the \d+-byte cap|timeout after \d+ s)$/.test(e?.message) ? e : new Error("vector source request failed");
      if (/byte cap/.test(last.message)) break;
    } finally {
      reservation?.release();
    }
  }
  throw last;
}

/** Load the source's TileJSON, cached for 12 hours; a stale copy is used offline. */
export async function loadTilejson(url = tilejsonUrl()) {
  const file = join(cacheRoot(), `tilejson-${hash(url)}.json`);
  let cached = null;
  if (existsSync(file)) {
    try {
      const stat = statSync(file);
      if (stat.size > MAX_TILEJSON_BYTES) throw new Error("cached TileJSON is too large");
      cached = checkTilejson(JSON.parse(readFileSync(file, "utf8")));
      if (Date.now() - stat.mtimeMs < TILEJSON_MAX_AGE_MS) return cached;
    } catch {
      cached = null;
    }
  }
  try {
    const buf = await getWithRetry(url, { accept: "application/json", maxBytes: MAX_TILEJSON_BYTES });
    let tj;
    try {
      tj = checkTilejson(JSON.parse(buf.toString("utf8")));
    } catch {
      throw new Error("The vector source did not return a valid TileJSON with a {z}/{x}/{y} tile URL.");
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(tj));
    return tj;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

function checkTilejson(tj) {
  const t = tj?.tiles?.[0];
  if (typeof t !== "string" || !["{z}", "{x}", "{y}"].every((p) => t.includes(p)) || !["http:", "https:"].includes(new URL(t).protocol)) {
    throw new Error("The vector source did not return a valid TileJSON with a {z}/{x}/{y} tile URL.");
  }
  return tj;
}

// Reserve each request's maximum body size before it starts. Release unused
// capacity when it finishes; bytes from failed attempts still spend the budget.
function downloadBudget() {
  let used = 0, reserved = 0;
  const waiting = new Set();
  const capError = () => new SpecError(`Vector tiles for this area pass the source's ${LIMITS.bytes / 1e6} MB download limit. Use a smaller radiusKm or region.`);
  return {
    get bytes() { return used; },
    async reserve(signal) {
      for (;;) {
        signal.throwIfAborted();
        const available = LIMITS.bytes - used - reserved;
        if (available >= MAX_TILE_BYTES || (available > 0 && !reserved)) {
          const maxBytes = Math.min(MAX_TILE_BYTES, available);
          reserved += maxBytes;
          let spent = 0;
          return {
            maxBytes,
            capError: maxBytes < MAX_TILE_BYTES ? capError : undefined,
            onBytes(count) { spent += count; used += count; reserved -= count; },
            release() {
              reserved -= maxBytes - spent;
              for (const wake of waiting) wake();
              waiting.clear();
            },
          };
        }
        if (!reserved) throw capError();
        await new Promise((resolve, reject) => {
          const wake = () => { signal.removeEventListener("abort", abort); resolve(); };
          const abort = () => { waiting.delete(wake); reject(signal.reason); };
          waiting.add(wake);
          signal.addEventListener("abort", abort, { once: true });
        });
      }
    },
  };
}

function readVectorTile(buf) {
  // Pbf's fixed-width reads assume a zero-offset ArrayBuffer, whereas small Node
  // Buffers often share a slab with a nonzero byteOffset.
  return new VectorTile(new Pbf(Uint8Array.from(buf)));
}

function validateTile(buf) {
  if (!buf.length) return; // 204/404 and valid empty tiles
  try {
    const tile = readVectorTile(buf);
    for (const layer of Object.values(tile.layers)) {
      if (!(layer.extent > 0)) throw new Error();
      for (let i = 0; i < layer.length; i++) layer.feature(i).loadGeometry();
    }
  } catch {
    throw new Error("The vector source returned an invalid vector tile.");
  }
}

/**
 * The highest zoom whose tile count fits the budget for that zoom. Zoom 14 holds
 * buildings and is the heaviest (up to about 0.5 MB a tile in dense cities), so
 * it gets the smallest budget; zoom 12 still carries every residential street.
 */
export function chooseVectorZoom(box, { maxZoom = 14, minZoom = 0, budgets = { 14: 80, 13: 400 }, maxTiles = LIMITS.tiles } = {}) {
  for (let z = maxZoom; z >= minZoom; z--) {
    const range = tileRange(box, z);
    const count = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
    if (count <= Math.min(budgets[z] ?? LIMITS.tiles, maxTiles)) return { zoom: z, range, count };
  }
  throw new SpecError(`This area needs more than ${maxTiles} vector tiles even at zoom ${minZoom}. Use a smaller area.`);
}

/**
 * Download (or reuse cached) tiles for a tile range. Returns raw tile buffers.
 * Throws a SpecError when the area breaks the source's download limits; other
 * errors mean the source could not be reached.
 */
export async function fetchVectorTiles({ zoom, range }, { log = () => {} } = {}) {
  const count = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
  if (!Number.isSafeInteger(count) || count < 1 || count > LIMITS.tiles) throw new SpecError(`This area exceeds the source's ${LIMITS.tiles} vector tiles per download. Use a smaller area.`);
  const sourceUrl = tilejsonUrl();
  const tj = await loadTilejson(sourceUrl);
  const source = sourceUrl === OPENFREEMAP ? "OpenFreeMap" : "the configured vector source";
  const template = tj.tiles[0];
  const n = 2 ** zoom;
  const jobs = [];
  // Keep unwrapped x for geometry, including the half of a dateline frame whose
  // longitudes lie beyond ±180°. Only network/cache coordinates wrap.
  for (let x = range.x0; x <= range.x1; x++) for (let y = range.y0; y <= range.y1; y++) jobs.push({ x, y, z: zoom });
  const dir = join(cacheRoot(), hash(template));
  let downloaded = 0;
  const budget = downloadBudget();
  const controller = new AbortController();
  let cursor = 0;
  const results = new Array(jobs.length);
  let announced = false;
  async function worker() {
    try {
      while (cursor < jobs.length) {
        controller.signal.throwIfAborted();
        const i = cursor++;
        const { y, z } = jobs[i];
        const x = ((jobs[i].x % n) + n) % n;
        const file = join(dir, `${z}`, `${x}`, `${y}.pbf`);
        if (existsSync(file)) {
          try {
            if (statSync(file).size > MAX_DECODED_BYTES) throw new Error();
            const buf = readFileSync(file);
            validateTile(buf);
            results[i] = { ...jobs[i], buf };
            continue;
          } catch {
            // A partial/corrupt cache entry must not poison later renders.
          }
        }
        if (!announced) {
          announced = true;
          log(`Downloading ${jobs.length} vector tiles at zoom ${zoom} from ${new URL(template).host}…`);
        }
        let buf = await getWithRetry(template.replace("{z}", z).replace("{x}", x).replace("{y}", y), {
          accept: "application/vnd.mapbox-vector-tile, application/x-protobuf, */*",
          maxBytes: MAX_TILE_BYTES,
          budget,
          signal: controller.signal,
        });
        downloaded += 1;
        controller.signal.throwIfAborted();
        if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: MAX_DECODED_BYTES });
        validateTile(buf);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, buf);
        results[i] = { ...jobs[i], buf };
      }
    } catch (e) {
      if (!controller.signal.aborted) controller.abort(e);
      throw e;
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(LIMITS.parallel, jobs.length) }, worker));
  controller.signal.throwIfAborted();
  return { tiles: results, downloaded, bytes: budget.bytes, zoom, count: jobs.length, source, attribution: VECTOR_ATTRIBUTION };
}

// ---------------------------------------------------------------------------
// Decoding

const ROAD = {
  motorway: "motorway", trunk: "trunk", primary: "primary", secondary: "secondary", tertiary: "tertiary",
  minor: "residential", service: "service", busway: "service", track: "path", path: "path",
};
const PATH_SKIP = new Set(["platform", "corridor"]);
const GREEN = new Set(["grass", "wood"]);
const GREEN_USE = new Set(["cemetery", "pitch", "stadium", "playground", "theme_park"]);
// POIs name the green area or building they stand in. A park POI only names a
// park-like area, a garden POI a garden, so a flowerbed never takes a park's name.
const PARK_POI = {
  park: new Set(["park", "recreation_ground", "village_green", "nature_reserve", "national_park", "protected_area"]),
  garden: new Set(["garden"]),
  cemetery: new Set(["cemetery"]),
};
const PLACE_POI = new Set(["museum", "monument", "attraction", "place_of_worship", "castle", "stadium", "theatre", "library", "townhall", "college", "university", "hospital"]);

/** Clip a polyline to the square [0, e]; returns the pieces inside. */
function clipLine(pts, e) {
  const out = [];
  let cur = [];
  const inside = ([x, y]) => x >= 0 && x <= e && y >= 0 && y <= e;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) {
      if (inside(p)) cur.push(p);
      continue;
    }
    const a = pts[i - 1];
    const seg = clipSegment(a, p, e);
    if (!seg) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    const [s0, s1] = seg;
    if (!cur.length || cur[cur.length - 1][0] !== s0[0] || cur[cur.length - 1][1] !== s0[1]) {
      if (cur.length > 1) out.push(cur);
      cur = [s0];
    }
    cur.push(s1);
    if (!inside(p)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Liang-Barsky segment clip to [0, e]². */
function clipSegment([x0, y0], [x1, y1], e) {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [[-dx, x0], [dx, e - x0], [-dy, y0], [dy, e - y0]]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [[x0 + t0 * dx, y0 + t0 * dy], [x0 + t1 * dx, y0 + t1 * dy]];
}

/** Sutherland-Hodgman ring clip to [0, e]². */
function clipRing(ring, e) {
  let pts = ring;
  const edges = [
    [(p) => p[0] >= 0, (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= e, (a, b) => { const t = (e - a[0]) / (b[0] - a[0]); return [e, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= 0, (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; }],
    [(p) => p[1] <= e, (a, b) => { const t = (e - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), e]; }],
  ];
  for (const [inside, cross] of edges) {
    if (!pts.length) break;
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) {
        if (!inside(prev)) next.push(cross(prev, cur));
        next.push(cur);
      } else if (inside(prev)) next.push(cross(prev, cur));
    }
    pts = next;
  }
  return pts.length >= 3 ? pts : null;
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

const bboxOf = (ring) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

const nameOf = (p) => (typeof p.name === "string" && p.name.trim() ? p.name.trim() : null);
const englishOf = (p) => {
  const en = p.name_en ?? p["name:en"];
  return typeof en === "string" && en.trim() && en.trim() !== nameOf(p) ? en.trim() : null;
};

/**
 * Decode tiles into lon/lat layers:
 *   roads { class: [line] }, rail [line], rivers [{ line, kind, name }],
 *   water [[ring]], parks [[ring]], beach [[ring]], buildings [{ rings, height, name, kind }],
 *   names: { streets [{ name, en, cls, ref, lines }], parks [{ name, en, kind, rings }], water [{ name, en, kind, lines }] }
 * Polygons are clipped to their tile and keep the tile's winding: fill them with
 * the nonzero rule given in `fillRule`.
 */
export function decodeTiles(tiles) {
  // Tile polygons keep their winding (outer clockwise, holes counter-clockwise),
  // so a nonzero fill unions overlapping areas, such as a garden inside a park.
  const out = { roads: {}, rail: [], rivers: [], water: [], parks: [], beach: [], buildings: [], coast: [], fillRule: "nonzero", names: { streets: [], parks: [], water: [] } };
  const green = [];
  for (const { x: tx, y: ty, z, buf } of tiles) {
    if (!buf?.length) continue;
    const vt = readVectorTile(buf);
    const n = 2 ** z;
    const each = (name, fn) => {
      const layer = vt.layers[name];
      if (!layer) return;
      const e = layer.extent;
      for (let i = 0; i < layer.length; i++) fn(layer.feature(i), e);
    };
    const toLonLat = (e) => ([px, py]) => {
      const wx = (tx + px / e) / n;
      const wy = (ty + py / e) / n;
      return [wx * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180) / Math.PI];
    };
    const geom = (f) => f.loadGeometry().map((r) => r.map((p) => [p.x, p.y]));
    const lines = (f, e) => {
      const ll = toLonLat(e);
      return geom(f).flatMap((l) => clipLine(l, e)).map((l) => l.map(ll));
    };
    // Polygons stay in tile units until POIs are matched to them.
    const rings = (f, e) => geom(f).map((r) => clipRing(r, e)).filter(Boolean);

    each("transportation", (f, e) => {
      const p = f.properties;
      if (f.type !== 2 || p.brunnel === "tunnel") return;
      if (p.class === "rail" || p.class === "transit") {
        if (p.subclass !== "subway") out.rail.push(...lines(f, e));
        return;
      }
      const cls = ROAD[p.class];
      if (!cls || (p.class === "path" && PATH_SKIP.has(p.subclass))) return;
      (out.roads[cls] ??= []).push(...lines(f, e));
    });
    each("transportation_name", (f, e) => {
      const p = f.properties;
      const name = nameOf(p);
      if (!name || f.type !== 2) return;
      const cls = ROAD[p.class];
      if (!cls) return;
      const ls = lines(f, e);
      if (ls.length) out.names.streets.push({ name, en: englishOf(p), cls, ref: typeof p.ref === "string" ? p.ref : null, lines: ls });
    });
    each("waterway", (f, e) => {
      const p = f.properties;
      if (f.type !== 2 || p.brunnel === "tunnel") return;
      if (p.class !== "river" && p.class !== "canal") return;
      const name = nameOf(p);
      for (const line of lines(f, e)) out.rivers.push({ line, kind: p.class, name });
      if (name) out.names.water.push({ name, en: englishOf(p), kind: p.class, lines: lines(f, e) });
    });

    const ll = (e) => toLonLat(e);
    const tileGreen = [];
    const tileBuilds = [];
    const polygons = (f, e) => classifyRings(f.loadGeometry())
      .map((poly) => poly.map((r) => clipRing(r.map((pt) => [pt.x, pt.y]), e)).filter(Boolean))
      .filter((rs) => rs.length);
    each("water", (f, e) => {
      const p = f.properties;
      if (f.type !== 3 || p.brunnel === "tunnel" || p.class === "swimming_pool") return;
      out.water.push(...rings(f, e).map((r) => [r.map(ll(e))]));
    });
    const addGreen = (layer, f, e, kind, extra = {}) => {
      const polys = polygons(f, e);
      for (const rs of polys) tileGreen.push({ rings: rs, e, kind, key: f.id ? `${layer}:${f.id}` : null, single: polys.length === 1, ...extra });
    };
    each("landcover", (f, e) => {
      const p = f.properties;
      if (f.type !== 3) return;
      if (p.class === "sand" && p.subclass === "beach") out.beach.push(...rings(f, e).map((r) => [r.map(ll(e))]));
      else if (GREEN.has(p.class)) addGreen("landcover", f, e, p.subclass ?? p.class);
    });
    each("landuse", (f, e) => {
      const p = f.properties;
      if (f.type === 3 && GREEN_USE.has(p.class)) addGreen("landuse", f, e, p.class);
    });
    each("park", (f, e) => {
      const p = f.properties;
      if (f.type === 3) addGreen("park", f, e, p.class, { name: nameOf(p), en: englishOf(p), rank: 0 });
    });
    each("building", (f, e) => {
      const p = f.properties;
      if (f.type !== 3) return;
      const h = Number(p.render_height);
      const height = Number.isFinite(h) && h > 0 ? h : null;
      // Sources merge neighbouring footprints into one feature; split them back
      // into single buildings (an outer ring and its holes) so each can be named.
      for (const rs of polygons(f, e)) tileBuilds.push({ rings: rs, e, height });
    });
    // The smallest matching area that contains the POI takes its name.
    each("poi", (f, e) => {
      const p = f.properties;
      const name = nameOf(p);
      if (!name || f.type !== 1) return;
      const pt = f.loadGeometry()[0]?.[0];
      if (!pt) return;
      const at = [pt.x, pt.y];
      const kinds = PARK_POI[p.class];
      const targets = kinds ? tileGreen.filter((g) => kinds.has(g.kind)) : PLACE_POI.has(p.class) ? tileBuilds : null;
      if (!targets?.length) return;
      const rank = Number(p.rank) || 99;
      let best = null;
      for (const t of targets) {
        if (t.e !== e) continue;
        t.bbox ??= bboxOf(t.rings[0]);
        if (at[0] < t.bbox[0] || at[0] > t.bbox[2] || at[1] < t.bbox[1] || at[1] > t.bbox[3]) continue;
        t.area ??= Math.abs(signedArea(t.rings[0]));
        if ((!best || t.area < best.area) && inRing(at, t.rings[0])) best = t;
      }
      if (best && !(best.name && best.rank <= rank)) Object.assign(best, { name, en: englishOf(p), rank, poiKind: p.subclass ?? p.class });
    });
    for (const g of tileGreen) green.push({ ...g, rings: g.rings.map((r) => r.map(ll(g.e))) });
    for (const b of tileBuilds) out.buildings.push({ rings: b.rings.map((r) => r.map(ll(b.e))), height: b.height, name: b.name ?? null, en: b.en ?? null, kind: b.poiKind ?? null });
  }
  // A park split across tiles is one feature id: share the name with every piece.
  const byKey = new Map();
  for (const g of green) if (g.name && g.key && g.single) byKey.set(g.key, g);
  for (const g of green) {
    const named = !g.name && g.key && g.single ? byKey.get(g.key) : null;
    if (named) Object.assign(g, { name: named.name, en: named.en, poiKind: named.poiKind });
    out.parks.push(...g.rings.map((r) => [r]));
    if (g.name) out.names.parks.push({ name: g.name, en: g.en ?? null, kind: g.poiKind ?? g.kind, rings: g.rings });
  }
  return out;
}
