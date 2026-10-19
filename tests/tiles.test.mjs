// Raster basemap: tile maths, zoom choice, and the wiring into render().
// No network: a stub fetchTile is injected through render()'s options.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { render } from "../skills/map-design/scripts/lib/render.mjs";
import http from "node:http";
import {
  resolveBasemap,
  lonLatToTile,
  tileToLonLat,
  tileRange,
  chooseZoom,
  defaultFetchTile,
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
  const dark = resolveBasemap({ preset: "carto-dark", maxTiles: 9, filter: "brightness(0.5)" });
  assert.equal(dark.url, PRESETS["carto-dark"].url);
  assert.equal(dark.requiresKey, true, "a keyed preset must declare it");
  assert.equal(resolveBasemap("osm").requiresKey, false, "osm is keyless");
  assert.equal(resolveBasemap({ preset: "carto-dark", url: "https://x/{z}/{x}/{y}.png" }).requiresKey, false);
  assert.equal(dark.maxTiles, 9);
  assert.equal(dark.filter, "brightness(0.5)");
  assert.match(resolveBasemap("carto-dark").attribution, /CARTO/);
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
  const voyager = resolveBasemap("voyager");
  assert.equal(voyager.url, PRESETS["carto-voyager"].url);
  assert.equal(voyager.requiresKey, true, "voyager keeps the CARTO key warning");
});

test("an unknown preset is rejected instead of silently falling back to osm", () => {
  assert.throws(() => resolveBasemap("banana"), /unknown basemap preset/);
  assert.throws(() => resolveBasemap({ preset: "lightt" }), /unknown basemap preset/);
});

test("filter and opacity are validated before they reach the SVG", () => {
  for (const bad of [
    'brightness(0.5)" onload="alert(1)',
    "url(https://evil.example/x.svg)",
    "drop-shadow(2px 2px 4px #000)",
    "brightness(0.5); color: red",
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
