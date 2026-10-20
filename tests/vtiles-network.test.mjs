import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pbf } from "../skills/map-design/scripts/vendor/vtile.mjs";
import { fetchVectorTiles, loadTilejson, decodeTiles, LIMITS } from "../skills/map-design/scripts/lib/vtiles.mjs";

const MB = 1024 * 1024;
const pick = { zoom: 4, range: { x0: 0, x1: 9, y0: 0, y1: 0 } };
const one = { zoom: 4, range: { x0: 0, x1: 0, y0: 0, y1: 0 } };
const url = "https://vector.invalid/metadata?key=private-test-key";
const template = "https://vector.invalid/{z}/{x}/{y}.pbf?key=private-test-key";
const metadata = () => Response.json({ tiles: [template] });

function setup(t, handler, byteLimit = LIMITS.bytes) {
  const oldCache = process.env.MAP_DESIGN_CACHE;
  const oldSource = process.env.MAP_DESIGN_TILEJSON;
  const oldLimit = LIMITS.bytes;
  const cache = mkdtempSync(join(tmpdir(), "map-design-vector-network-"));
  process.env.MAP_DESIGN_CACHE = cache;
  process.env.MAP_DESIGN_TILEJSON = url;
  LIMITS.bytes = byteLimit;
  t.mock.method(globalThis, "fetch", handler);
  t.after(() => {
    if (oldCache === undefined) delete process.env.MAP_DESIGN_CACHE;
    else process.env.MAP_DESIGN_CACHE = oldCache;
    if (oldSource === undefined) delete process.env.MAP_DESIGN_TILEJSON;
    else process.env.MAP_DESIGN_TILEJSON = oldSource;
    LIMITS.bytes = oldLimit;
    rmSync(cache, { recursive: true, force: true });
  });
  return cache;
}

function roadTile() {
  const pbf = new Pbf();
  pbf.writeMessage(3, (_, layer) => {
    layer.writeVarintField(15, 2);
    layer.writeStringField(1, "transportation");
    layer.writeStringField(3, "class");
    layer.writeMessage(4, (__, value) => value.writeStringField(1, "primary"));
    layer.writeVarintField(5, 4096);
    layer.writeMessage(2, (__, feature) => {
      feature.writePackedVarint(2, [0, 0]);
      feature.writeVarintField(3, 2);
      feature.writePackedVarint(4, [9, 0, 4096, 10, 8192, 0]);
    });
  });
  return Buffer.from(pbf.finish());
}

function paddedTile(size) {
  const pbf = new Pbf();
  // An unknown protobuf field pads a valid synthetic tile without extra geometry.
  pbf.writeBytesField(100, new Uint8Array(size));
  return Buffer.concat([roadTile(), pbf.finish()]);
}

test("a fatal response cancels parallel vector requests and stops queued jobs", async (t) => {
  let requests = 0, canceled = 0;
  const signals = [];
  setup(t, async (target, { signal }) => {
    if (target === url) return metadata();
    requests++;
    signals.push(signal);
    const body = new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => { canceled++; controller.error(signal.reason); }, { once: true });
      },
    });
    return new Response(body, { headers: { "content-length": String(requests === 3 ? 5 * MB : 4 * MB) } });
  });
  await assert.rejects(fetchVectorTiles(pick), /byte cap/);
  assert.equal(requests, 4, "only the four initial parallel requests start");
  assert.ok(signals.every((s) => s.aborted));
  assert.equal(canceled, 4);
  await new Promise((r) => setImmediate(r));
  assert.equal(requests, 4, "no worker keeps downloading after the operation rejects");
});

test("parallel reservations cannot overspend the aggregate byte budget", async (t) => {
  let requests = 0;
  const tile = paddedTile(4 * MB - 100);
  setup(t, async (target) => {
    if (target === url) return metadata();
    requests++;
    return new Response(tile, { headers: { "content-length": String(tile.length) } });
  }, 9 * MB);
  await assert.rejects(fetchVectorTiles(pick), /download limit/);
  assert.equal(requests, 3, "the remaining 1 MB cannot fund another 4 MB body");
});

test("a request waits for unused reservations instead of failing a tile that fits", async (t) => {
  let requests = 0;
  setup(t, async (target) => {
    if (target === url) return metadata();
    const tile = paddedTile((++requests === 1 ? 2 : 3) * MB - 100);
    return new Response(tile, { headers: { "content-length": String(tile.length) } });
  }, 6 * MB);
  const got = await fetchVectorTiles({ zoom: 4, range: { x0: 0, x1: 1, y0: 0, y1: 0 } });
  assert.equal(got.count, 2);
  assert.equal(got.downloaded, 2);
  assert.ok(got.bytes < 6 * MB);
});

test("a chunked vector response is stopped at its reserved body cap", async (t) => {
  let requests = 0, reads = 0, canceled = false;
  setup(t, async (target) => {
    if (target === url) return metadata();
    requests++;
    return {
      status: 200, ok: true, headers: new Headers(),
      body: { getReader: () => ({
        async read() { reads++; return { value: new Uint8Array(40), done: false }; },
        async cancel() { canceled = true; },
      }) },
    };
  }, 64);
  await assert.rejects(fetchVectorTiles(pick), /download limit/);
  assert.equal(requests, 1);
  assert.equal(reads, 2);
  assert.equal(canceled, true);
});

test("bytes received before a dropped connection still count against retries", async (t) => {
  let requests = 0, reads = 0;
  setup(t, async (target) => {
    if (target === url) return metadata();
    requests++;
    if (requests > 1) return new Response(new Uint8Array(40), { headers: { "content-length": "40" } });
    return {
      status: 200, ok: true, headers: new Headers(),
      body: { getReader: () => ({
        async read() {
          if (reads++) throw new Error(`connection dropped at ${template}`);
          return { value: new Uint8Array(40), done: false };
        },
      }) },
    };
  }, 64);
  await assert.rejects(fetchVectorTiles(one), (e) => /download limit/.test(e.message) && !/private-test-key/.test(e.message));
  assert.equal(requests, 2, "the retry cannot spend the same 40 bytes twice");
});

test("invalid TileJSON diagnostics omit the source URL and response text", async (t) => {
  let response = { wrong: true };
  setup(t, async () => Response.json(response));
  await assert.rejects(loadTilejson(), (e) => /valid TileJSON/.test(e.message) && !/private-test-key|vector.invalid/.test(e.message));
  response = { tiles: ["https://[invalid/{z}/{x}/{y}?key=secret-in-template"] };
  await assert.rejects(loadTilejson(), (e) => /valid TileJSON/.test(e.message) && !/secret-in-template/.test(e.message));
  t.mock.method(globalThis, "fetch", async () => new Response(`invalid JSON ${url}`));
  await assert.rejects(loadTilejson(), (e) => /valid TileJSON/.test(e.message) && !/private-test-key/.test(e.message));
});

test("invalid vector responses are not cached and corrupt cache entries are refetched", async (t) => {
  let tileRequests = 0, invalid = true;
  const cache = setup(t, async (target) => {
    if (target === url) return metadata();
    tileRequests++;
    return new Response(invalid ? "<html>temporarily unavailable</html>" : roadTile());
  });
  await assert.rejects(fetchVectorTiles(one), /invalid vector tile/);
  assert.equal(readdirSync(cache, { recursive: true }).filter((f) => f.endsWith(".pbf")).length, 0);
  invalid = false;
  await fetchVectorTiles(one);
  const file = join(cache, readdirSync(cache, { recursive: true }).find((f) => f.endsWith(".pbf")));
  writeFileSync(file, "<html>bad cache entry</html>");
  const got = await fetchVectorTiles(one);
  assert.equal(tileRequests, 3);
  assert.equal(decodeTiles(got.tiles).roads.primary.length, 1);
  assert.deepEqual(readFileSync(file), roadTile());
});

test("dateline tiles wrap only the request and cache coordinates", async (t) => {
  const requested = [];
  setup(t, async (target) => {
    if (target === url) return metadata();
    requested.push(new URL(target).pathname);
    return new Response(roadTile());
  });
  const got = await fetchVectorTiles({ zoom: 2, range: { x0: 3, x1: 4, y0: 1, y1: 1 } });
  assert.equal(got.source, "the configured vector source");
  assert.deepEqual(requested.sort(), ["/2/0/1.pbf", "/2/3/1.pbf"]);
  assert.deepEqual(got.tiles.map((tile) => tile.x), [3, 4]);
  const roads = decodeTiles(got.tiles).roads.primary;
  assert.deepEqual(roads.map((line) => line.map(([lon]) => lon)), [[90, 180], [180, 270]]);
  await fetchVectorTiles({ zoom: 2, range: { x0: 0, x1: 0, y0: 1, y1: 1 } });
  assert.equal(requested.length, 2, "the same wrapped tile is reused from cache");
});

test("excessive tile ranges fail before TileJSON or tile requests", async (t) => {
  let requests = 0;
  setup(t, async () => { requests++; return metadata(); });
  await assert.rejects(fetchVectorTiles({ zoom: 14, range: { x0: 0, x1: 3000, y0: 0, y1: 0 } }), /3000 vector tiles/);
  assert.equal(requests, 0);
});
