import { test } from "node:test";
import assert from "node:assert/strict";
import { polylabel, labelPointFromPath } from "../skills/map-design/scripts/lib/polylabel.mjs";
import { coastToLand, clipPolyline } from "../skills/map-design/scripts/lib/osm.mjs";
import { mainland, countryFeature } from "../skills/map-design/scripts/lib/geo.mjs";
import * as G from "../skills/map-design/scripts/vendor/geo.mjs";

const area = (ring) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(s / 2);
};

test("polylabel finds the middle of a square and the thick part of an L", () => {
  const sq = polylabel([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], 0.1);
  assert.ok(Math.abs(sq.x - 5) < 0.2 && Math.abs(sq.y - 5) < 0.2);
  assert.ok(Math.abs(sq.r - 5) < 0.2);
  const p = labelPointFromPath("M0,0L100,0L100,20L20,20L20,100L0,100Z");
  // The widest circle sits in the elbow: r = 20√2 / (1 + √2) ≈ 11.7.
  assert.ok(p.r > 11 && p.r < 12.5, `elbow radius ${p.r}`);
});

test("clipPolyline marks where a line enters and leaves", () => {
  const pieces = clipPolyline([[-10, 5], [5, 5], [15, 5]], [0, 0, 10, 10]);
  assert.equal(pieces.length, 1);
  assert.deepEqual(pieces[0].coords, [[0, 5], [5, 5], [10, 5]]);
  assert.equal(pieces[0].enters, true);
  assert.equal(pieces[0].exits, true);
});

test("coastline with land on the left becomes the land polygon", () => {
  const id = (p) => p;
  const rect = [0, 0, 100, 100];
  const north = coastToLand([{ nodes: [1, 2, 3], coords: [[-10, 40], [50, 40], [110, 40]] }], id, rect);
  assert.equal(north.sea, true);
  assert.equal(north.land.length, 1);
  assert.equal(area(north.land[0]), 6000);
  const south = coastToLand([{ nodes: [3, 2, 1], coords: [[110, 40], [50, 40], [-10, 40]] }], id, rect);
  assert.equal(area(south.land[0]), 4000);
});

test("ways are chained by node id and islands stay islands", () => {
  const id = (p) => p;
  const ways = [
    { nodes: [1, 2], coords: [[-10, 50], [50, 50]] },
    { nodes: [2, 3], coords: [[50, 50], [110, 50]] },
    { nodes: [7, 8, 9, 10, 7], coords: [[40, 10], [60, 10], [60, 20], [40, 20], [40, 10]] },
  ];
  const r = coastToLand(ways, id, [0, 0, 100, 100]);
  assert.equal(r.land.length, 2);
  const sizes = r.land.map(area).sort((a, b) => a - b);
  assert.deepEqual(sizes, [200, 5000]);
});

test("no coastline means no sea", () => {
  assert.deepEqual(coastToLand([], (p) => p, [0, 0, 1, 1]), { land: [], sea: false });
});

test("mainland framing drops far territories", () => {
  const fra = mainland(countryFeature("FRA"));
  const [[w], [e]] = G.geoBounds(fra);
  assert.ok(w > -10 && e < 12, `France frame ${w}..${e}`);
  const idn = mainland(countryFeature("IDN"));
  const [[iw], [ie]] = G.geoBounds(idn);
  assert.ok(iw < 100 && ie > 135, `Indonesia keeps Sumatra to Papua: ${iw}..${ie}`);
});
