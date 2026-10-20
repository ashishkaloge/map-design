// Raster basemap: tile maths, zoom choice, and the wiring into render().
// No network: a stub fetchTile is injected through render()'s options.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";

import { render } from "../skills/map-design/scripts/lib/render.mjs";
import http from "node:http";
import {
  resolveBasemap,
  lonLatToTile,
  tileToLonLat,
  tileRange,
  chooseZoom,
  defaultFetchTile,
  rasterBasemap,
  DARK_FILTER,
  PRESETS,
} from "../skills/map-design/scripts/lib/tiles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const opts = { base: here, embedFonts: false };

// 1x1 transparent PNG
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const stubFetch = async () => ({ data: PIXEL, cached: true });

test("a coordinate falls inside the tile that lonLatToTile returns", () => {
  for (const [lon, lat] of [[12.5683, 55.6761], [-9.14, 38.72], [0, 0], [139.7, 35.68]]) {
    for (const z of [8, 13, 17]) {
      const t = lonLatToTile(lon, lat, z);
      const nw = tileToLonLat(Math.floor(t.x), Math.floor(t.y), z);
      const se = tileToLonLat(Math.floor(t.x) + 1, Math.floor(t.y) + 1, z);
      assert.ok(lon >= nw.lon - 1e-9 && lon <= se.lon + 1e-9, `lon outside tile at z${z}`);
      assert.ok(lat <= nw.lat + 1e-9 && lat >= se.lat - 1e-9, `lat outside tile at z${z}`);
    }
  }
});

test("tileRange covers the box and never runs past the world edge", () => {
  const box = { west: 12.45, east: 12.66, south: 55.61, north: 55.75 };
  const r = tileRange(box, 13);
  assert.ok(r.x0 <= r.x1 && r.y0 <= r.y1);
  const nw = tileToLonLat(r.x0, r.y0, 13);
  const se = tileToLonLat(r.x1 + 1, r.y1 + 1, 13);
  assert.ok(nw.lon <= box.west + 1e-9 && se.lon >= box.east - 1e-9);
  assert.ok(nw.lat >= box.north - 1e-9 && se.lat <= box.south + 1e-9);
  const polar = tileRange({ west: -180, east: 180, south: -89, north: 89 }, 2);
  assert.ok(polar.x0 >= 0 && polar.y0 >= 0);
  assert.ok(polar.x1 <= 3 && polar.y1 <= 3);
});

test("chooseZoom respects the tile budget", () => {
  const box = { west: 12.45, east: 12.66, south: 55.61, north: 55.75 };
  for (const maxTiles of [4, 16, 64]) {
    const { zoom, range } = chooseZoom(box, { maxTiles, maxZoom: 17 });
    const count = (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
    assert.ok(count <= maxTiles, `budget ${maxTiles} exceeded: ${count}`);
    assert.ok(zoom >= 0 && zoom <= 17);
  }
  const tight = chooseZoom(box, { maxTiles: 400, maxZoom: 17 });
  const loose = chooseZoom(box, { maxTiles: 4, maxZoom: 17 });
  assert.ok(tight.zoom > loose.zoom, "a bigger budget must buy more zoom");
});

test("basemap presets and overrides resolve", () => {
  assert.equal(resolveBasemap(undefined), null);
  assert.equal(resolveBasemap(true).url, PRESETS.osm.url);
  const darkUrl = `${PRESETS["carto-dark"].url}?key=fixture`;
  const dark = resolveBasemap({ preset: "carto-dark", url: darkUrl, maxTiles: 9, filter: "brightness(0.5)" });
  assert.equal(dark.url, darkUrl);
  assert.equal(dark.requiresKey, true, "a keyed preset must declare it");
  assert.equal(resolveBasemap("osm").requiresKey, false, "osm is keyless");
  assert.equal(resolveBasemap({ preset: "carto-dark", url: "https://x/{z}/{x}/{y}.png" }).requiresKey, false);
  assert.equal(dark.maxTiles, 9);
  assert.equal(dark.filter, "brightness(0.5)");
  assert.match(dark.attribution, /CARTO/);
  assert.match(resolveBasemap("osm").attribution, /OpenStreetMap/);
  const custom = resolveBasemap({ url: "https://example.test/{z}/{x}/{y}.png", attribution: "Mine" });
  assert.equal(custom.url, "https://example.test/{z}/{x}/{y}.png");
  assert.equal(custom.attribution, "Mine");
});

test("render embeds tiles under the data and forces mercator", async () => {
  const spec = {
    kind: "bubbles",
    title: "Tiles",
    region: [12.45, 55.61, 12.66, 55.75],
    size: "landscape",
    data: [
      { place: "Copenhagen", country: "DNK", runs: 427 },
      { place: "Aarhus", country: "DNK", runs: 26 },
      { place: "Odense", country: "DNK", runs: 12 },
    ],
    value: "runs",
    labelTop: 3,
    basemap: "light",
  };
  const r = await render(spec, { ...opts, fetchTile: stubFetch });
  assert.ok(r.svg.includes('class="basemap-raster"'), "raster group missing");
  assert.ok((r.svg.match(/<image /g) ?? []).length > 0, "no tile images");
  assert.ok(r.svg.includes("data:image/png;base64,"), "tiles must be self-contained");
  assert.match(r.svg, /OpenStreetMap/, "attribution must reach the footer");
  assert.ok(
    r.report.warnings.some((w) => /mercator/.test(w)),
    "forced projection must be reported"
  );
  // tiles sit below the thematic layer
  assert.ok(r.svg.indexOf('class="basemap-raster"') < r.svg.indexOf('class="data"'));
});

test("render degrades to vector geography when tiles fail", async () => {
  const spec = {
    kind: "bubbles",
    title: "No tiles",
    region: [12.45, 55.61, 12.66, 55.75],
    size: "landscape",
    data: [
      { place: "Copenhagen", country: "DNK", runs: 427 },
      { place: "Aarhus", country: "DNK", runs: 26 },
      { place: "Odense", country: "DNK", runs: 12 },
    ],
    value: "runs",
    labelTop: 3,
    basemap: "light",
  };
  const r = await render(spec, { ...opts, fetchTile: async () => ({ error: "HTTP 503" }) });
  assert.ok(!r.svg.includes('class="basemap-raster"'), "failed tiles must not appear");
  assert.ok(r.report.warnings.some((w) => /no tiles/.test(w)), "failure must be reported");
  assert.ok(r.svg.includes('class="base"'), "vector basemap must still be there");
});

test("no basemap means no network call and no mercator forcing", async () => {
  let called = 0;
  const r = await render(
    { kind: "bubbles", title: "Plain", labelTop: 3,
      data: [{ place: "Copenhagen", country: "DNK", runs: 427 }, { place: "Aarhus", country: "DNK", runs: 26 }],
      value: "runs" },
    { ...opts, fetchTile: async () => { called += 1; return { data: PIXEL }; } }
  );
  assert.equal(called, 0, "a spec without basemap must not fetch");
  assert.ok(!r.svg.includes('class="basemap-raster"'));
  assert.ok(!r.report.warnings.some((w) => /mercator/.test(w)));
});

test("a basemap gets an untilted mercator, so tiles stay square", async () => {
  const geo = await import("../skills/map-design/scripts/lib/geo.mjs");
  const extent = [[41, 152], [1159, 1438]];
  const framed = geo.frame({ kind: "route", region: "DNK", projection: "mercator" }, extent, null);
  assert.equal(
    framed.projection.rotate()[1],
    0,
    "autoProjection's centre latitude must not be rotated into a cylindrical projection"
  );
  const size = (y) => {
    const a = framed.projection([tileToLonLat(135, y, 8).lon, tileToLonLat(135, y, 8).lat]);
    const b = framed.projection([tileToLonLat(136, y + 1, 8).lon, tileToLonLat(136, y + 1, 8).lat]);
    return { w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
  };
  const north = size(86);
  const south = size(95);
  assert.ok(Math.abs(north.w - south.w) < 0.01, "a tile's projected width must not change with latitude");
  assert.ok(Math.abs(north.h - south.h) < 0.01, "a tile's projected height must not change with latitude");
  assert.ok(Math.abs(north.w - north.h) < 0.01, "mercator tiles must project to squares");
});

test("rendered tiles are all the same size and tile the frame", async () => {
  const spec = {
    kind: "route",
    title: "Tiling",
    region: "DNK",
    size: "portrait",
    basemap: { preset: "osm", maxTiles: 40 },
    routes: [{ name: "a", stops: [{ lon: 12.56, lat: 55.68 }, { lon: 9.53, lat: 55.71 }] }],
    numbered: false,
  };
  const r = await render(spec, { ...opts, fetchTile: stubFetch });
  const rects = [...r.svg.matchAll(/<image x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({
    x: +m[1], y: +m[2], w: +m[3], h: +m[4],
  }));
  assert.ok(rects.length > 1, "expected several tiles");
  const widths = new Set(rects.map((t) => t.w.toFixed(2)));
  assert.equal(widths.size, 1, `tile widths must be uniform, got ${[...widths].join(", ")}`);
  // within each row, tiles must touch (no horizontal holes)
  const rows = new Map();
  for (const t of rects) {
    const key = t.y.toFixed(0);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(t);
  }
  for (const [y, row] of rows) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x - (row[i - 1].x + row[i - 1].w);
      assert.ok(gap < 1.5 && gap > -3, `gap of ${gap.toFixed(2)} px in row y=${y}`);
    }
  }
});

// --- Regression: validation, budget enforcement and fetch bounds (review on PR #1) ---

test("documented aliases resolve to real styles", () => {
  const light = resolveBasemap("light");
  assert.equal(light.url, PRESETS.osm.url, "light is the standard OSM style");
  assert.equal(light.requiresKey, false);
  const dark = resolveBasemap("dark");
  assert.equal(dark.url, PRESETS.osm.url, "dark is the keyless inverted-OSM recipe");
  assert.equal(dark.filter, DARK_FILTER);
  assert.equal(dark.requiresKey, false);
  const voyagerUrl = `${PRESETS["carto-voyager"].url}?key=fixture`;
  const voyager = resolveBasemap({ preset: "voyager", url: voyagerUrl });
  assert.equal(voyager.url, voyagerUrl);
  assert.equal(voyager.requiresKey, true, "voyager keeps the CARTO key requirement");
});

test("an unknown preset is rejected instead of silently falling back to osm", () => {
  assert.throws(() => resolveBasemap("banana"), /unknown basemap preset/);
  assert.throws(() => resolveBasemap({ preset: "lightt" }), /unknown basemap preset/);
  assert.throws(() => resolveBasemap("toString"), /unknown basemap preset/);
  assert.throws(() => resolveBasemap("__proto__"), /unknown basemap preset/);
});

test("filter and opacity are validated before they reach the SVG", () => {
  for (const bad of [
    'brightness(0.5)" onload="alert(1)',
    "url(https://evil.example/x.svg)",
    "drop-shadow(2px 2px 4px #000)",
    "brightness(0.5); color: red",
    "url(1)",
    "brightness(1..2)",
    42,
  ]) {
    assert.throws(() => resolveBasemap({ preset: "osm", filter: bad }), /basemap\.filter/, JSON.stringify(bad));
  }
  for (const good of [DARK_FILTER, "saturate(0.6) brightness(0.72)", "grayscale(50%)", "blur(1.5px)"]) {
    assert.equal(resolveBasemap({ preset: "osm", filter: good }).filter, good);
  }
  for (const bad of [-0.1, 1.5, "0.5", NaN, Infinity]) {
    assert.throws(() => resolveBasemap({ preset: "osm", opacity: bad }), /basemap\.opacity/, String(bad));
  }
  assert.equal(resolveBasemap({ preset: "osm", opacity: 0.5 }).opacity, 0.5);
});

test("world and dateline frames request nearby tiles and keep a square lattice", async () => {
  for (const region of ["world", "NZL", "FJI", { center: [179.5, 0], radiusKm: 300 }]) {
    const requested = [];
    const result = await render({
      kind: "points", title: "Wrapped geography", region, size: "square", labelTop: 0,
      data: [{ lon: 179.5, lat: 0 }], basemap: { preset: "osm", maxTiles: 144 },
    }, {
      ...opts,
      fetchTile: async (url) => { requested.push(url); return { data: PIXEL }; },
    });
    const indices = requested.map((url) => url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/).slice(1).map(Number));
    assert.ok(indices.length > 1 && indices.length <= 144);
    assert.equal(new Set(requested).size, requested.length, "wrap placements must reuse one tile request");
    const [zoom] = indices[0];
    assert.ok(indices.every(([, x, y]) => x >= 0 && x < 2 ** zoom && y >= 0 && y < 2 ** zoom));
    const xs = new Set(indices.map(([, x]) => x));
    if (region === "world") {
      assert.equal(xs.size, 2 ** zoom, "a world frame needs every longitude column");
    } else {
      assert.ok(xs.has(0) && xs.has(2 ** zoom - 1), "a dateline frame must include both sides");
      assert.ok(xs.size < 2 ** zoom / 2, "a regional frame must not request the opposite side of the world");
    }
    const images = [...result.svg.matchAll(/<image x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)]
      .map((m) => m.slice(1).map(Number));
    const width = images[0][2];
    assert.ok(width < result.width, "a single tile must not be stretched across the frame");
    assert.ok(images.every(([, , w, h]) => Math.abs(w - width) < 0.01 && Math.abs(h - width) < 0.01));
    const rows = new Map();
    for (const image of images) {
      const key = image[1].toFixed(2);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(image);
    }
    for (const row of rows.values()) {
      row.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < row.length; i++) {
        assert.ok(Math.abs(row[i][0] - row[i - 1][0] - width + 0.5) < 0.02, "tiles must meet without gaps or seam stretching");
      }
    }
  }
});

test("a one-tile world budget reuses the world tile across the projection seam", async () => {
  const requested = [];
  const result = await render({
    kind: "points", title: "One world tile", region: "world",
    data: [{ lon: 0, lat: 0 }], basemap: { preset: "osm", maxTiles: 1, zoom: 18 },
  }, { ...opts, fetchTile: async (url) => { requested.push(url); return { data: PIXEL }; } });
  assert.deepEqual(requested, [PRESETS.osm.url.replace("{z}", 0).replace("{x}", 0).replace("{y}", 0)]);
  assert.match(result.svg, /class="basemap-raster"/);
  const widths = [...result.svg.matchAll(/<image [^>]*width="([^"]+)"/g)].map((m) => Number(m[1]));
  assert.ok(widths.every((width) => width > 100), "world tile must not collapse at the seam");
});

test("wrapped world tiles are clipped to the fitted world instead of painting the gutters", async () => {
  const { frame, G } = await import("../skills/map-design/scripts/lib/geo.mjs");
  const rect = [[0, 0], [1000, 500]];
  const spec = { kind: "points", region: "world", projection: "mercator", antarctica: true, basemap: { preset: "osm", maxTiles: 1 } };
  const { projection } = frame(spec, rect);
  let calls = 0;
  const raster = await rasterBasemap({ spec, projection, rect, fetchTile: async () => { calls++; return { data: PIXEL }; } });
  assert.equal(calls, 1);
  assert.equal([...raster.group.matchAll(/<image /g)].length, 2, "both seam placements must remain available");
  const match = raster.group.match(/<clipPath id="([^"]+)" clipPathUnits="userSpaceOnUse"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"\/><\/clipPath>/);
  assert.ok(match, "raster must define a geographic clip");
  assert.ok(raster.group.includes(`clip-path="url(#${match[1]})"`), "the styled raster group must reference the clip");
  const clip = match.slice(2).map(Number);
  const [[left, top], [right, bottom]] = G.geoPath(projection).bounds({ type: "Sphere" });
  for (const [actual, expected] of clip.map((value, i) => [value, [left, top, right - left, bottom - top][i]])) {
    assert.ok(Math.abs(actual - expected) < 0.02, `clip ${clip} must match the fitted sphere bounds`);
  }
  assert.deepEqual(clip, [250, 0, 500, 500], "landscape world gutters must stay outside raster imagery");
});

test("tile imagery contains the coordinates projected through the data projection", async () => {
  const { frame } = await import("../skills/map-design/scripts/lib/geo.mjs");
  const rect = [[40, 100], [1160, 1100]];
  for (const [region, points] of [
    ["world", [[0, 0], [120, 35], [-170, -12]]],
    [{ center: [179.5, 0], radiusKm: 300 }, [[179.9, 0], [-179.9, 1]]],
  ]) {
    const spec = { kind: "points", projection: "mercator", region, basemap: "osm" };
    const { projection } = frame(spec, rect);
    const raster = await rasterBasemap({
      spec, projection, rect,
      fetchTile: async (url) => ({ data: Buffer.from(url).toString("base64") }),
    });
    const images = [...raster.group.matchAll(/<image x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"[^>]*base64,([^"]+)"/g)]
      .map((m) => ({ rect: m.slice(1, 5).map(Number), url: Buffer.from(m[5], "base64").toString() }));
    for (const [lon, lat] of points) {
      const tile = lonLatToTile(lon, lat, raster.zoom);
      const url = PRESETS.osm.url.replace("{z}", raster.zoom).replace("{x}", Math.floor(tile.x)).replace("{y}", Math.floor(tile.y));
      const [x, y] = projection([lon, lat]);
      assert.ok(images.some(({ rect: [left, top, width, height], url: imageUrl }) =>
        imageUrl === url && x >= left - 0.02 && x <= left + width && y >= top - 0.02 && y <= top + height
      ), `imagery must align with the data at ${lon}/${lat}`);
    }
  }
});

test("check validates basemap configuration without fetching or writing a cache", async (t) => {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "map-design-check-"));
  const oldCache = process.env.MAP_DESIGN_TILE_CACHE;
  const originalFetch = globalThis.fetch;
  process.env.MAP_DESIGN_TILE_CACHE = join(dir, "tiles");
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(Buffer.from(PIXEL, "base64"), { headers: { "content-type": "image/png" } }); };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (oldCache === undefined) delete process.env.MAP_DESIGN_TILE_CACHE;
    else process.env.MAP_DESIGN_TILE_CACHE = oldCache;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const spec = { kind: "points", title: "Check", data: [{ lon: 12.56, lat: 55.68 }], basemap: "osm" };
  const result = await render(spec, { ...opts, check: true });
  assert.equal(calls, 0);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.ok(result.report.notes.some((note) => /check skips tile/.test(note)));
  await assert.rejects(render({ ...spec, basemap: { opacity: "invalid" } }, { ...opts, check: true }), /opacity/);
});

test("provider cache policy disables CARTO disk caching and refreshes old tiles", async (t) => {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "map-design-cache-"));
  const oldCache = process.env.MAP_DESIGN_TILE_CACHE;
  const originalFetch = globalThis.fetch;
  process.env.MAP_DESIGN_TILE_CACHE = dir;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(Buffer.from(PIXEL, "base64"), { headers: { "content-type": "image/png" } }); };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (oldCache === undefined) delete process.env.MAP_DESIGN_TILE_CACHE;
    else process.env.MAP_DESIGN_TILE_CACHE = oldCache;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const carto = "https://basemaps.cartocdn.com/light_all/0/0/0.png?key=fixture";
  assert.equal(resolveBasemap({ preset: "carto-light", url: `${PRESETS["carto-light"].url}?key=fixture`, cache: true }).cache, false);
  assert.equal(resolveBasemap({ url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=fixture" }).cache, false);
  assert.equal(resolveBasemap({ url: "https://BASEMAPS.CARTOCDN.COM./light_all/{z}/{x}/{y}.png?key=fixture" }).cache, false);
  for (const host of ["a", "b", "c", "d"]) {
    assert.equal(resolveBasemap({ url: `https://${host}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=fixture` }).cache, false);
  }
  await defaultFetchTile(carto);
  await defaultFetchTile(carto);
  assert.equal(calls, 2);
  assert.deepEqual(await fs.readdir(dir), [], "CARTO must not write a disk cache");

  const osm = "https://tile.openstreetmap.org/0/0/0.png";
  await defaultFetchTile(osm);
  const fresh = await defaultFetchTile(osm);
  assert.equal(fresh.cached, true);
  assert.equal(calls, 3, "fresh OSM tiles must be reused");
  const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const file = join(dir, createHash("sha1").update(osm).digest("hex") + ".png");
  await fs.utimes(file, old, old);
  const refreshed = await defaultFetchTile(osm);
  assert.equal(refreshed.cached, false);
  assert.equal(calls, 4, "expired tiles must be refreshed");
  assert.throws(() => resolveBasemap({ preset: "osm", cache: false }), /requires caching/);
});

test("CARTO endpoints require a nonempty key before checks, rendering or direct fetching", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("network must not run"); };
  for (const preset of ["carto-light", "carto-dark", "carto-voyager", "voyager"]) {
    assert.throws(() => resolveBasemap(preset), /CARTO.*nonempty key/);
  }
  for (const host of ["a", "b", "c", "d"]) {
    assert.throws(() => resolveBasemap({ url: `https://${host}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png` }), /CARTO.*nonempty key/);
  }
  for (const suffix of ["", "?key=", "?key=%20", "?api_key=fixture", "?key=fixture&key=second"]) {
    const url = `https://BASEMAPS.CARTOCDN.COM./light_all/{z}/{x}/{y}.png${suffix}`;
    assert.throws(() => resolveBasemap({ url }), /CARTO.*nonempty key/);
    const result = await defaultFetchTile(url);
    assert.match(result.error, /CARTO.*nonempty key/);
    assert.ok(!result.error.includes("fixture"));
  }
  const spec = { kind: "points", data: [{ lon: 0, lat: 0 }], basemap: "carto-dark" };
  for (const check of [true, false]) {
    await assert.rejects(render(spec, { ...opts, check }), /CARTO.*nonempty key/);
  }
  assert.equal(calls, 0);
  assert.doesNotThrow(() => resolveBasemap({ url: "https://example.test/{z}/{x}/{y}.png" }));
  assert.doesNotThrow(() => resolveBasemap({ url: "https://basemaps.cartocdn.com.example.test/{z}/{x}/{y}.png" }));
});

test("non-PNG HTTP success and corrupt cache entries cannot replace the vector basemap", async (t) => {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "map-design-png-"));
  const oldCache = process.env.MAP_DESIGN_TILE_CACHE;
  const originalFetch = globalThis.fetch;
  process.env.MAP_DESIGN_TILE_CACHE = dir;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (oldCache === undefined) delete process.env.MAP_DESIGN_TILE_CACHE;
    else process.env.MAP_DESIGN_TILE_CACHE = oldCache;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const html = "<html><body>Provider temporarily unavailable; please try again later.</body></html>";
  const url = "https://example.test/0/0/0.png";
  for (const type of ["text/html", "image/png"]) {
    globalThis.fetch = async () => new Response(html, { headers: { "content-type": type } });
    const result = await defaultFetchTile(url);
    assert.match(result.error, /PNG|image\/png/);
    assert.equal(result.data, undefined);
    assert.deepEqual(await fs.readdir(dir), [], "invalid responses must not be cached");
  }
  const rendered = await render({
    kind: "points", title: "Unavailable tiles", region: [12.45, 55.61, 12.66, 55.75],
    data: [{ lon: 12.56, lat: 55.68 }], basemap: { url: "https://example.test/{z}/{x}/{y}.png", maxTiles: 1 },
  }, opts);
  assert.ok(!rendered.svg.includes('class="basemap-raster"'));
  assert.ok(rendered.report.warnings.some((warning) => /using the vector geography/.test(warning)));

  const file = join(dir, createHash("sha1").update(url).digest("hex") + ".png");
  await fs.writeFile(file, html);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(Buffer.from(PIXEL, "base64"), { headers: { "content-type": "image/png" } });
  };
  const repaired = await defaultFetchTile(url);
  assert.equal(calls, 1, "a corrupt cache entry must not count as a cache hit");
  assert.equal(repaired.cached, false);
  assert.equal(repaired.data, PIXEL);
  assert.equal((await fs.readFile(file)).toString("base64"), PIXEL);
});

test("provider attribution remains visible and linked in exported SVG", async () => {
  const result = await render({
    kind: "points", title: "Credits", region: [12.45, 55.61, 12.66, 55.75],
    data: [{ lon: 12.56, lat: 55.68 }], basemap: "osm-hot",
  }, { ...opts, fetchTile: stubFetch });
  assert.match(result.svg, /tiles by OpenStreetMap France/);
  assert.match(result.svg, /<a href="https:\/\/www\.openstreetmap\.org\/copyright">/);
  assert.match(result.svg, />www\.openstreetmap\.org\/copyright<\/text>/);
  assert.equal(resolveBasemap({ url: "https://example.test/{z}/{x}/{y}.png" }).attribution, "");
});

test("tile errors do not disclose keyed request URLs and redirects are rejected", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const url = "https://example.test/0/0/0.png?key=private-fixture";
  globalThis.fetch = async (requested, options) => {
    assert.equal(options.redirect, "error");
    throw new Error(`could not fetch ${requested}`);
  };
  const result = await defaultFetchTile(url, { cache: false });
  assert.equal(result.error, "tile request failed");
  assert.throws(
    () => resolveBasemap({ url: "https://example.test/0/0/0.png?key=private-fixture" }),
    (error) => !error.message.includes("private-fixture") && /placeholder/.test(error.message),
  );
});

test("zoom and tile budgets are bounded integers", () => {
  for (const bad of [1.5, -1, 26, "14"]) assert.throws(() => resolveBasemap({ preset: "osm", zoom: bad }), /basemap\.zoom/, String(bad));
  for (const bad of [0, -5, 1.5, 4097, "400"]) assert.throws(() => resolveBasemap({ preset: "osm", maxTiles: bad }), /basemap\.maxTiles/, String(bad));
  for (const bad of [-1, 26, 1.5]) assert.throws(() => resolveBasemap({ preset: "osm", maxZoom: bad }), /basemap\.maxZoom/, String(bad));
  assert.equal(resolveBasemap({ preset: "osm", zoom: 25, maxZoom: 25 }).zoom, 25);
});

test("an explicit zoom above the preset's maxZoom is clamped with a warning", () => {
  const cfg = resolveBasemap({ preset: "osm", zoom: 22 });
  assert.equal(cfg.zoom, 19);
  assert.ok(cfg.warnings.some((w) => /clamped/.test(w)));
});

test("a custom url without attribution earns a warning", () => {
  const cfg = resolveBasemap({ url: "https://example.test/{z}/{x}/{y}.png" });
  assert.ok(cfg.warnings.some((w) => /attribution/.test(w)));
});

test("a hostile filter never reaches the SVG: render rejects the spec", async () => {
  const spec = {
    kind: "bubbles",
    title: "Injection",
    region: [12.45, 55.61, 12.66, 55.75],
    size: "landscape",
    data: [
      { place: "Copenhagen", country: "DNK", runs: 427 },
      { place: "Aarhus", country: "DNK", runs: 26 },
    ],
    value: "runs",
    labelTop: 3,
    basemap: { preset: "osm", filter: 'brightness(0.5)" onload="alert(1)' },
  };
  await assert.rejects(render(spec, { ...opts, fetchTile: stubFetch }), /basemap\.filter/);
});

test("the dark alias renders inverted OSM tiles", async () => {
  const spec = {
    kind: "bubbles",
    title: "Dark",
    region: [12.45, 55.61, 12.66, 55.75],
    size: "landscape",
    data: [
      { place: "Copenhagen", country: "DNK", runs: 427 },
      { place: "Aarhus", country: "DNK", runs: 26 },
    ],
    value: "runs",
    labelTop: 3,
    basemap: "dark",
  };
  const r = await render(spec, { ...opts, fetchTile: stubFetch });
  assert.ok(r.svg.includes("invert(1) hue-rotate(180deg)"), "dark alias must apply the dark filter");
  assert.match(r.svg, /OpenStreetMap/, "dark tiles are still OSM tiles and keep the credit");
});

test("maxTiles is enforced even with an explicit zoom", async () => {
  const spec = {
    kind: "bubbles",
    title: "Budget",
    region: [12.45, 55.61, 12.66, 55.75],
    size: "landscape",
    data: [
      { place: "Copenhagen", country: "DNK", runs: 427 },
      { place: "Aarhus", country: "DNK", runs: 26 },
    ],
    value: "runs",
    labelTop: 3,
    basemap: { preset: "osm", zoom: 14, maxTiles: 8 },
  };
  const r = await render(spec, { ...opts, fetchTile: stubFetch });
  assert.ok(
    r.report.warnings.some((w) => /over the maxTiles budget/.test(w)),
    "an explicit zoom that blows the budget must be reported"
  );
  const tiles = (r.svg.match(/<image /g) ?? []).length;
  assert.ok(tiles > 0 && tiles <= 8, `expected at most 8 tiles, got ${tiles}`);
});

test("an explicit zoom inside the budget is honored", async () => {
  const spec = {
    kind: "bubbles",
    title: "Explicit zoom",
    region: [12.45, 55.61, 12.66, 55.75],
    size: "landscape",
    data: [
      { place: "Copenhagen", country: "DNK", runs: 427 },
      { place: "Aarhus", country: "DNK", runs: 26 },
    ],
    value: "runs",
    labelTop: 3,
    basemap: { preset: "osm", zoom: 10, maxTiles: 400 },
  };
  const r = await render(spec, { ...opts, fetchTile: stubFetch });
  assert.ok(r.report.notes.some((nt) => /at zoom 10\b/.test(nt)), "the explicit zoom must be used");
  assert.ok(!r.report.warnings.some((w) => /maxTiles budget/.test(w)));
});

test("fetch bounds: oversized and unresponsive tiles are rejected", async (t) => {
  const pixel = Buffer.from(PIXEL, "base64");
  const big = Buffer.alloc(64 * 1024, 1);
  const server = http.createServer((req, res) => {
    res.on("error", () => {}); // the timeout test aborts mid-response
    if (req.url === "/pixel.png") {
      res.writeHead(200, { "content-type": "image/png", "content-length": pixel.length });
      res.end(pixel);
    } else if (req.url === "/big.png") {
      res.writeHead(200, { "content-type": "image/png", "content-length": big.length });
      res.end(big);
    } else if (req.url === "/big-chunked.png") {
      res.writeHead(200, { "content-type": "image/png" }); // no content-length: chunked
      res.end(big);
    } else if (req.url === "/slow.png") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(pixel);
      }, 400);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const ok = await defaultFetchTile(`${base}/pixel.png`, { cache: false });
  assert.equal(ok.data, PIXEL, "a normal tile round-trips");

  const declared = await defaultFetchTile(`${base}/big.png`, { cache: false, maxBytes: 1024 });
  assert.ok(declared.error && /cap/.test(declared.error), `declared oversize must fail: ${JSON.stringify(declared)}`);

  const chunked = await defaultFetchTile(`${base}/big-chunked.png`, { cache: false, maxBytes: 1024 });
  assert.ok(chunked.error && /cap/.test(chunked.error), `streamed oversize must fail: ${JSON.stringify(chunked)}`);

  const slow = await defaultFetchTile(`${base}/slow.png`, { cache: false, timeoutMs: 60 });
  assert.ok(slow.error && /timeout/i.test(slow.error), `a stalled tile must time out: ${JSON.stringify(slow)}`);
});
