// OpenStreetMap data for city posters, fetched from the public Overpass API and
// cached on disk. Map data © OpenStreetMap contributors, ODbL 1.0.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SpecError } from "./errors.mjs";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const USER_AGENT = "map-design/0.1 (+https://github.com/ashishkaloge/map-design)";

const ROADS = {
  low: "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link",
  medium: "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|road",
  high: "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|road|service|pedestrian|footway|path|cycleway|track|steps",
};

export function cacheDir() {
  const base = process.env.MAP_DESIGN_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "map-design");
  const dir = join(base, "osm");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function overpassQuery([s, w, n, e], detail = "medium") {
  const b = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  const roads = ROADS[detail] ?? ROADS.medium;
  // No [maxsize]: Overpass admits smaller declared budgets sooner when busy.
  return `[out:json][timeout:150];
(
  way["highway"~"^(${roads})$"](${b});
  way["natural"~"^(water|coastline|wood|scrub|grassland|heath|beach)$"](${b});
  relation["natural"~"^(water|wood)$"](${b});
  way["waterway"~"^(riverbank|river|canal|dock)$"](${b});
  way["water"](${b});
  relation["water"](${b});
  way["landuse"~"^(reservoir|basin|forest|grass|meadow|recreation_ground|village_green|cemetery)$"](${b});
  relation["landuse"~"^(reservoir|forest|grass|meadow)$"](${b});
  way["leisure"~"^(park|garden|nature_reserve|golf_course)$"](${b});
  relation["leisure"~"^(park|nature_reserve|garden)$"](${b});
  way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"](${b});
);
out geom qt;`;
}

/** Fetch (or reuse cached) Overpass JSON for a bbox. */
export async function fetchOsm(bbox, { detail = "medium", endpoint, log = () => {} } = {}) {
  const query = overpassQuery(bbox, detail);
  const key = createHash("sha1").update(query).digest("hex").slice(0, 16);
  const file = join(cacheDir(), `${key}.json`);
  if (existsSync(file)) {
    log(`Using cached OpenStreetMap data (${file}).`);
    return JSON.parse(readFileSync(file, "utf8"));
  }
  const endpoints = endpoint ? [endpoint] : ENDPOINTS;
  const waits = [5, 15, 30, 60];
  let lastError;
  for (const url of endpoints) {
    for (let attempt = 0; attempt <= waits.length; attempt++) {
      try {
        log(`Downloading OpenStreetMap data from ${new URL(url).host}…`);
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT, accept: "application/json" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(240000),
        });
        if ([429, 502, 503, 504].includes(res.status) && attempt < waits.length) {
          // The public server is at capacity; it asks clients to back off.
          lastError = new Error(`Overpass is busy (HTTP ${res.status})`);
          log(`Overpass is busy (HTTP ${res.status}); retrying in ${waits[attempt]} s.`);
          await new Promise((r) => setTimeout(r, waits[attempt] * 1000));
          continue;
        }
        if (!res.ok) throw new Error(`Overpass returned HTTP ${res.status}`);
        const json = await res.json();
        if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new Error(`Overpass: ${json.remark}`);
        writeFileSync(file, JSON.stringify(json));
        return json;
      } catch (e) {
        lastError = e;
        break;
      }
    }
  }
  throw new SpecError(`Could not download OpenStreetMap data (${lastError?.message}). The public Overpass API may be busy: wait a few minutes and retry, use a smaller radiusKm or "detail": "low", or set "overpass" to another endpoint.`);
}

// ---------------------------------------------------------------------------
// Classification

const ROAD_CLASS = {
  motorway: "motorway", motorway_link: "motorway", trunk: "trunk", trunk_link: "trunk",
  primary: "primary", primary_link: "primary", secondary: "secondary", secondary_link: "secondary",
  tertiary: "tertiary", tertiary_link: "tertiary", residential: "residential", unclassified: "residential",
  living_street: "residential", road: "residential", service: "service", pedestrian: "path", footway: "path",
  path: "path", cycleway: "path", track: "path", steps: "path",
};

const isWater = (t) =>
  t.natural === "water" || t.waterway === "riverbank" || t.waterway === "dock" || t.water != null || t.landuse === "reservoir" || t.landuse === "basin";
const isPark = (t) =>
  ["park", "garden", "nature_reserve", "golf_course"].includes(t.leisure) ||
  ["forest", "grass", "meadow", "recreation_ground", "village_green", "cemetery"].includes(t.landuse) ||
  ["wood", "scrub", "grassland", "heath"].includes(t.natural);

const pts = (geometry) => (geometry ?? []).filter(Boolean).map((g) => [g.lon, g.lat]);

/** Split Overpass elements into roads, rivers, rail, water/park polygons and coastline ways. */
export function classify(osm) {
  const out = { roads: {}, rivers: [], rail: [], water: [], parks: [], coast: [], beach: [] };
  for (const el of osm.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === "way") {
      const line = pts(el.geometry);
      if (line.length < 2) continue;
      const closed = el.nodes && el.nodes[0] === el.nodes[el.nodes.length - 1];
      if (t.natural === "coastline") out.coast.push({ nodes: el.nodes, coords: line });
      else if (t.highway && ROAD_CLASS[t.highway]) {
        if (t.tunnel === "yes" || t.tunnel === "building_passage") continue;
        // Separately mapped sidewalks and crossings double every street; skip them.
        if (t.footway === "sidewalk" || t.footway === "crossing" || t.footway === "traffic_island") continue;
        (out.roads[ROAD_CLASS[t.highway]] ??= []).push(line);
      } else if (t.railway) {
        if (t.tunnel === "yes" || t.railway === "subway") continue;
        out.rail.push(line);
      } else if ((t.waterway === "river" || t.waterway === "canal") && !closed) out.rivers.push({ line, kind: t.waterway });
      else if (isWater(t) && closed) out.water.push([line]);
      else if (t.natural === "beach" && closed) out.beach.push([line]);
      else if (isPark(t) && closed) out.parks.push([line]);
    } else if (el.type === "relation") {
      const rings = assembleRelation(el);
      if (!rings.length) continue;
      if (isWater(t)) out.water.push(...rings);
      else if (isPark(t)) out.parks.push(...rings);
    }
  }
  return out;
}

/** Join a multipolygon relation's member ways into closed rings (outer and inner together; drawn even-odd). */
function assembleRelation(rel) {
  const ways = (rel.members ?? []).filter((m) => m.type === "way" && m.geometry?.length > 1).map((m) => pts(m.geometry));
  const key = ([x, y]) => `${x.toFixed(7)},${y.toFixed(7)}`;
  const rings = [];
  const pool = ways.slice();
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 5000) {
      const end = key(ring[ring.length - 1]);
      const i = pool.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end);
      if (i < 0) break;
      const [w] = pool.splice(i, 1);
      ring = ring.concat((key(w[0]) === end ? w : w.slice().reverse()).slice(1));
    }
    if (ring.length > 3) rings.push(ring);
  }
  // One polygon per relation: all its rings, drawn with even-odd fill.
  return rings.length ? [rings] : [];
}

// ---------------------------------------------------------------------------
// Coastline to land polygons

/**
 * Build land polygons inside a rectangle from OSM coastline ways. Works in a
 * y-up planar frame: `project` maps [lon, lat] to [x, y] with y increasing
 * north. OSM coastlines keep land on the left of their direction.
 * Returns { land: [[ [x,y], ... ], ...], sea: boolean } or null if the
 * coastline could not be closed cleanly.
 */
export function coastToLand(coastWays, project, rect) {
  if (!coastWays.length) return { land: [], sea: false };
  const [x0, y0, x1, y1] = rect;
  const W = x1 - x0;
  const H = y1 - y0;
  const P = 2 * W + 2 * H;

  // 1. Merge ways into chains by shared node ids.
  const chains = mergeChains(coastWays);
  const islands = [];
  const pieces = [];
  const inside = ([x, y]) => x > x0 && x < x1 && y > y0 && y < y1;
  for (const chain of chains) {
    let pts = chain.coords.map(project);
    if (chain.closed && pts.every(inside)) {
      islands.push(pts);
      continue;
    }
    if (chain.closed) {
      // Start a closed ring at a point outside the box so clipping yields whole pieces.
      const k = pts.findIndex((p) => !inside(p));
      pts = pts.slice(k).concat(pts.slice(1, k + 1));
    }
    pieces.push(...clipPolyline(pts, rect));
  }
  if (!pieces.length) return { land: islands, sea: islands.length > 0 };

  // 2. Snap loose ends (truncated data) onto the nearest edge.
  const snap = ([x, y]) => {
    const d = [x - x0, x1 - x, y - y0, y1 - y];
    const m = Math.min(...d);
    if (m === d[0]) return [x0, y];
    if (m === d[1]) return [x1, y];
    if (m === d[2]) return [x, y0];
    return [x, y1];
  };
  const pos = ([x, y]) => {
    // Counterclockwise distance along the boundary from (x0, y0).
    const e = 1e-6 * (W + H);
    if (Math.abs(y - y0) < e) return x - x0;
    if (Math.abs(x - x1) < e) return W + (y - y0);
    if (Math.abs(y - y1) < e) return W + H + (x1 - x);
    return 2 * W + H + (y1 - y);
  };
  for (const p of pieces) {
    if (!p.enters) p.coords.unshift(snap(p.coords[0]));
    if (!p.exits) p.coords.push(snap(p.coords[p.coords.length - 1]));
    p.tin = pos(p.coords[0]);
    p.tout = pos(p.coords[p.coords.length - 1]);
  }
  const corners = [[x1, y0, W], [x1, y1, W + H], [x0, y1, 2 * W + H], [x0, y0, P]];

  // 3. Walk: piece → boundary counterclockwise → next entry → … until closed.
  const used = new Set();
  const land = [];
  for (const start of pieces) {
    if (used.has(start)) continue;
    const ring = [];
    let cur = start;
    let guard = 0;
    while (cur && guard++ < pieces.length + 2) {
      used.add(cur);
      ring.push(...cur.coords);
      // Next entry counterclockwise from this exit.
      let best = null;
      let bestD = Infinity;
      for (const q of pieces) {
        const d = (q.tin - cur.tout + P) % P;
        if (d < bestD && (q !== cur || d > 0) && (!used.has(q) || q === start)) {
          bestD = d;
          best = q;
        }
      }
      if (!best) return null;
      // Corners passed on the way.
      for (const [cx, cy, ct] of corners) {
        const dc = (ct - cur.tout + P) % P;
        if (dc > 0 && dc < bestD) ring.push([cx, cy, dc]);
      }
      sortCorners(ring);
      if (best === start) break;
      cur = best;
    }
    if (ring.length > 2) land.push(ring.map(([x, y]) => [x, y]));
  }
  return { land: land.concat(islands), sea: true };
}

// Corners were appended with their distance as a third value; order them.
function sortCorners(ring) {
  let i = ring.length;
  while (i > 0 && ring[i - 1].length === 3) i--;
  const tail = ring.splice(i).sort((a, b) => a[2] - b[2]);
  ring.push(...tail);
}

function mergeChains(ways) {
  const list = ways.map((w) => ({ nodes: w.nodes.slice(), coords: w.coords.slice() }));
  const byStart = new Map();
  for (const w of list) byStart.set(w.nodes[0], w);
  const used = new Set();
  const chains = [];
  for (const w of list) {
    if (used.has(w)) continue;
    used.add(w);
    const chain = { nodes: w.nodes.slice(), coords: w.coords.slice() };
    // Extend forward.
    let next = byStart.get(chain.nodes[chain.nodes.length - 1]);
    while (next && !used.has(next) && chain.nodes[0] !== chain.nodes[chain.nodes.length - 1]) {
      used.add(next);
      chain.nodes.push(...next.nodes.slice(1));
      chain.coords.push(...next.coords.slice(1));
      next = byStart.get(chain.nodes[chain.nodes.length - 1]);
    }
    // Extend backward.
    let prev = list.find((x) => !used.has(x) && x.nodes[x.nodes.length - 1] === chain.nodes[0]);
    while (prev) {
      used.add(prev);
      chain.nodes.unshift(...prev.nodes.slice(0, -1));
      chain.coords.unshift(...prev.coords.slice(0, -1));
      prev = list.find((x) => !used.has(x) && x.nodes[x.nodes.length - 1] === chain.nodes[0]);
    }
    chain.closed = chain.nodes[0] === chain.nodes[chain.nodes.length - 1];
    chains.push(chain);
  }
  return chains;
}

/** Clip a polyline to a rectangle. Returns pieces { coords, enters, exits }. */
export function clipPolyline(points, [x0, y0, x1, y1]) {
  const pieces = [];
  let cur = null;
  const inside = ([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (inside(points[0])) cur = { coords: [points[0]], enters: false, exits: false };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = clipSegment(a, b, x0, y0, x1, y1);
    if (!seg) {
      if (cur) { pieces.push(cur); cur = null; }
      continue;
    }
    const [p, q, t0, t1] = seg;
    if (!cur) cur = { coords: [p], enters: t0 > 0 || !inside(a), exits: false };
    else if (t0 > 0) {
      pieces.push(cur);
      cur = { coords: [p], enters: true, exits: false };
    }
    cur.coords.push(q);
    if (t1 < 1) {
      cur.exits = true;
      pieces.push(cur);
      cur = null;
    }
  }
  if (cur) pieces.push(cur);
  return pieces.filter((p) => p.coords.length > 1);
}

/** Liang–Barsky segment clipping. Returns [p, q, t0, t1] or null. */
function clipSegment([ax, ay], [bx, by], x0, y0, x1, y1) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const checks = [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [[ax + t0 * dx, ay + t0 * dy], [ax + t1 * dx, ay + t1 * dy], t0, t1];
}
