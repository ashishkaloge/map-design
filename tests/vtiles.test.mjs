import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pbf } from "../skills/map-design/scripts/vendor/vtile.mjs";
import { decodeTiles, chooseVectorZoom, LIMITS } from "../skills/map-design/scripts/lib/vtiles.mjs";
import { lonLatToTile, tileToLonLat } from "../skills/map-design/scripts/lib/tiles.mjs";
import { resolveStreetBasemap, streetBasemap } from "../skills/map-design/scripts/lib/streets.mjs";
import { render } from "../skills/map-design/scripts/lib/render.mjs";
import { toHtml } from "../skills/map-design/scripts/lib/html.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const opts = { base: here, embedFonts: false, log: () => {} };

// --- A tiny Mapbox Vector Tile encoder (spec v2), enough for synthetic tiles. ---
const zz = (v) => (v << 1) ^ (v >> 31);
const cmd = (id, count) => (id & 7) | (count << 3);
function geometry(type, parts) {
  const out = [];
  let x = 0, y = 0;
  for (const part of parts) {
    const [x0, y0] = part[0];
    out.push(cmd(1, 1), zz(x0 - x), zz(y0 - y));
    x = x0;
    y = y0;
    const rest = type === 3 ? part.slice(1, -1) : part.slice(1);
    if (rest.length) {
      out.push(cmd(2, rest.length));
      for (const [px, py] of rest) {
        out.push(zz(px - x), zz(py - y));
        x = px;
        y = py;
      }
    }
    if (type === 3) out.push(cmd(7, 1));
  }
  return out;
}
function encodeTile(layers) {
  const pbf = new Pbf();
  for (const [name, features] of Object.entries(layers)) {
    pbf.writeMessage(3, (_, p) => {
      const keys = [], values = [];
      const index = (list, v) => { const i = list.indexOf(v); return i >= 0 ? i : list.push(v) - 1; };
      p.writeVarintField(15, 2);
      p.writeStringField(1, name);
      for (const f of features) {
        p.writeMessage(2, (__, fp) => {
          if (f.id) fp.writeVarintField(1, f.id);
          const tags = [];
          for (const [k, v] of Object.entries(f.props ?? {})) tags.push(index(keys, k), index(values, v));
          fp.writePackedVarint(2, tags);
          fp.writeVarintField(3, f.type);
          fp.writePackedVarint(4, geometry(f.type, f.parts));
        });
      }
      for (const k of keys) p.writeStringField(3, k);
      for (const v of values) p.writeMessage(4, (___, vp) => {
        if (typeof v !== "number") vp.writeStringField(1, String(v));
        else if (Number.isInteger(v)) vp.writeSVarintField(6, v);
        else vp.writeDoubleField(3, v);
      });
      p.writeVarintField(5, 4096);
    });
  }
  return Buffer.from(pbf.finish());
}

// A city block around the centre of one zoom-14 tile. Exterior rings run
// clockwise in tile coordinates (y down), as the spec requires.
const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const TILE = encodeTile({
  transportation: [
    { type: 2, props: { class: "primary" }, parts: [[[0, 2048], [4096, 2048]]] },
    { type: 2, props: { class: "minor" }, parts: [[[2048, 0], [2048, 4096]]] },
    { type: 2, props: { class: "minor", brunnel: "tunnel" }, parts: [[[0, 100], [4096, 100]]] },
    { type: 2, props: { class: "path", subclass: "footway" }, parts: [[[100, 0], [100, 4096]]] },
    { type: 2, props: { class: "rail", subclass: "rail" }, parts: [[[0, 3900], [4096, 3900]]] },
  ],
  transportation_name: [{ type: 2, props: { class: "primary", name: "Grand Avenue", name_en: "Grand Avenue", ref: "D1" }, parts: [[[0, 2048], [4096, 2048]]] }],
  water: [{ id: 7, type: 3, props: { class: "lake" }, parts: [square(2600, 2600, 3600, 3600)] }],
  waterway: [{ type: 2, props: { class: "river", name: "Clear River" }, parts: [[[1900, 0], [1900, 4096]]] }],
  landcover: [{ id: 11, type: 3, props: { class: "grass", subclass: "park" }, parts: [square(400, 400, 1600, 1600)] }],
  building: [{ id: 21, type: 3, props: { render_height: 24 }, parts: [square(2200, 1000, 2600, 1400), square(2700, 1000, 2900, 1200)] }],
  poi: [
    { type: 1, props: { class: "park", name: "Central Green", rank: 1 }, parts: [[[1000, 1000]]] },
    { type: 1, props: { class: "museum", subclass: "museum", name: "City Museum", rank: 2 }, parts: [[[2400, 1200]]] },
  ],
});

// Centre the test frames on the middle of the tile that holds the features.
const Z = 14, TX = 8600, TY = 5600;
const center = (() => {
  const a = tileToLonLat(TX, TY, Z), b = tileToLonLat(TX + 1, TY + 1, Z);
  return [(a.lon + b.lon) / 2, (a.lat + b.lat) / 2];
})();

let server, base, hits = 0, cache;
before(async () => {
  cache = mkdtempSync(join(tmpdir(), "map-design-vt-"));
  process.env.MAP_DESIGN_CACHE = cache;
  server = http.createServer((req, res) => {
    hits++;
    if (req.url === "/tiles.json") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ tiles: [`${base}/t/{z}/{x}/{y}.pbf`], maxzoom: 14 }));
    }
    if (req.url === "/overpass" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(readFileSync(join(here, "fixtures/mini-osm.json")));
    }
    const m = req.url.match(/^\/t\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m && +m[1] === Z && +m[2] === TX && +m[3] === TY) {
      res.writeHead(200, { "content-type": "application/vnd.mapbox-vector-tile" });
      return res.end(TILE);
    }
    res.writeHead(m ? 204 : 404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.MAP_DESIGN_TILEJSON = `${base}/tiles.json`;
});
after(async () => {
  delete process.env.MAP_DESIGN_TILEJSON;
  delete process.env.MAP_DESIGN_CACHE;
  await new Promise((r) => server.close(r));
  rmSync(cache, { recursive: true, force: true });
});

test("vector tiles decode into poster layers with names", () => {
  const layers = decodeTiles([{ x: TX, y: TY, z: Z, buf: TILE }]);
  assert.equal(layers.roads.primary.length, 1);
  assert.equal(layers.roads.residential.length, 1, "tunnels are skipped");
  assert.equal(layers.roads.path.length, 1);
  assert.equal(layers.rail.length, 1);
  assert.equal(layers.water.length, 1);
  assert.equal(layers.buildings.length, 2, "a merged building feature splits into footprints");
  const museum = layers.buildings.find((b) => b.name);
  assert.equal(museum.name, "City Museum");
  assert.equal(museum.height, 24);
  assert.deepEqual(layers.names.parks.map((p) => p.name), ["Central Green"]);
  assert.equal(layers.names.streets[0].name, "Grand Avenue");
  assert.equal(layers.names.water[0].name, "Clear River");
  // Coordinates are real lon/lat inside the tile.
  const [lon, lat] = layers.roads.primary[0][0];
  const t = lonLatToTile(lon, lat, Z);
  assert.ok(t.x >= TX && t.x <= TX + 1 && Math.floor(t.y) === TY);
});

test("vector zoom steps down to fit the tile budget", () => {
  const box = { west: center[0] - 0.2, east: center[0] + 0.2, south: center[1] - 0.15, north: center[1] + 0.15 };
  const z = chooseVectorZoom(box);
  assert.ok(z.zoom < 14 && z.count <= 400);
  assert.throws(() => chooseVectorZoom({ west: -170, east: 170, south: -80, north: 80 }, { minZoom: 10 }), /more than 3000 vector tiles/);
  assert.equal(LIMITS.parallel, 4);
});

test("fractional vector properties decode correctly from a sliced Node Buffer", () => {
  const tile = encodeTile({ building: [{ type: 3, props: { render_height: 12.5 }, parts: [square(100, 100, 200, 200)] }] });
  const slab = Buffer.alloc(tile.length + 23, 0xff);
  tile.copy(slab, 23);
  const sliced = slab.subarray(23);
  assert.notEqual(sliced.byteOffset, 0);
  assert.equal(decodeTiles([{ x: TX, y: TY, z: Z, buf: sliced }]).buildings[0].height, 12.5);
});

test("a poster draws buildings, credits OpenMapTiles and indexes hover details", async () => {
  const r = await render({ kind: "poster", center, radiusKm: 0.35, title: "Testville", theme: "paper" }, opts);
  assert.match(r.svg, /class="buildings"/);
  assert.match(r.svg, /class="road primary"/);
  assert.match(r.svg, /© OpenMapTiles\.org © OpenStreetMap contributors/);
  assert.ok(r.report.notes.some((n) => /vector tiles at zoom 14/.test(n)));
  assert.ok(r.report.notes.some((n) => /from the configured vector source/.test(n)));
  const names = r.interactive.items.map((i) => `${i.n} | ${i.i}`);
  assert.ok(names.some((n) => /^Grand Avenue \| Main road · D1$/.test(n)), names.join("\n"));
  assert.ok(names.some((n) => /^City Museum \| Museum · about 24 m tall$/.test(n)));
  assert.ok(names.some((n) => /^Central Green \| Park · /.test(n)));
  assert.ok(names.some((n) => /^Clear River \| River$/.test(n)));
  const before = hits;
  await render({ kind: "poster", center, radiusKm: 0.35, title: "Testville" }, opts);
  assert.equal(hits - before, 0, "re-renders use the disk cache");
});

test("posters fall back to Overpass when vector tiles are unreachable", async () => {
  process.env.MAP_DESIGN_TILEJSON = "http://127.0.0.1:9/unreachable.json";
  try {
    const r = await render({ kind: "poster", center: [10, 50], radiusKm: 1, overpass: `${base}/overpass` }, opts);
    assert.ok(r.report.warnings.some((w) => /Vector tiles unavailable/.test(w)));
    assert.match(r.svg, /class="road motorway"/);
    await assert.rejects(render({ kind: "poster", center: [10, 50], radiusKm: 1, source: "vector" }, opts));
  } finally {
    process.env.MAP_DESIGN_TILEJSON = `${base}/tiles.json`;
  }
  await assert.rejects(render({ kind: "poster", center, source: "tiles" }, opts), /source must be/);
});

test("the streets basemap draws themed vector streets under data maps", async () => {
  const spec = {
    kind: "points", basemap: "streets", theme: "ink",
    region: [center[0] - 0.008, center[1] - 0.006, center[0] + 0.008, center[1] + 0.006],
    data: [{ lon: center[0], lat: center[1], name: "Here" }], label: "name",
  };
  const before = hits;
  const checked = await render(spec, { ...opts, check: true });
  assert.equal(hits, before, "check downloads nothing");
  assert.ok(checked.report.notes.some((n) => /streets configuration validated/.test(n)));
  const r = await render(spec, opts);
  assert.match(r.svg, /class="basemap-streets"/);
  assert.match(r.svg, /class="streets-road primary"/);
  assert.match(r.svg, /OpenMapTiles/);
  assert.ok(r.interactive.items.some((i) => i.n === "Grand Avenue"));
  assert.throws(() => resolveStreetBasemap({ preset: "streets", url: "https://x/{z}/{x}/{y}" }), /not an option/);
  assert.throws(() => resolveStreetBasemap({ preset: "streets", maxTiles: 5000 }), /maxTiles/);
  const hitsBeforeExplicitZoom = hits;
  await assert.rejects(render({
    ...spec,
    region: [center[0] - 0.1, center[1] - 0.1, center[0] + 0.1, center[1] + 0.1],
    basemap: { preset: "streets", zoom: 14, maxTiles: 1 },
  }, opts), /more than 1 vector tiles even at zoom 14/);
  assert.equal(hits, hitsBeforeExplicitZoom, "an explicit over-budget zoom fails before any network access");
});

test("a streets frame across the dateline uses its short longitude span", async () => {
  const wrap = (lon) => ((lon + 540) % 360) - 180;
  const projection = ([lon, lat]) => [100 + wrap(lon - 180) * 1000, 100 - lat * 1000];
  projection.invert = ([x, y]) => [wrap(180 + (x - 100) / 1000), (100 - y) / 1000];
  const r = await streetBasemap({
    cfg: resolveStreetBasemap({ preset: "streets", zoom: 4 }),
    theme: { land: "#ffffff", text: "#222222", ocean: "#aabbcc" },
    projection, rect: [[0, 0], [200, 200]], log: () => {},
  });
  assert.ok(r.notes.some((note) => /4 vector tiles at zoom 4/.test(note)));
});

test("the HTML page embeds hover details without breaking out of the script", () => {
  const html = toHtml({ svg: '<svg viewBox="0 0 10 10"></svg>', width: 10, height: 10, features: [{ k: "l", n: "</script><b>x", i: "Street", g: [[0, 0, 10, 10]] }], accent: "#C2412D" });
  assert.match(html, /<script type="application\/json" id="map-features">/);
  assert.doesNotMatch(html, /<\/script><b>x/);
  assert.match(html, /\\u003c\/script>/);
  assert.match(html, /const HL = "#C2412D"/);
  assert.match(toHtml({ svg: "<svg></svg>", width: 1, height: 1, accent: 'red" onload="x' }), /const HL = "#E8590C"/, "only hex accents are used");
});
