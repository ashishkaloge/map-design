import { test } from "node:test";
import assert from "node:assert/strict";
import { colorScale, jenksBreaks, niceBreak, radiusScale } from "../skills/map-design/scripts/lib/scales.mjs";
import { toOklab, fromOklab, ramp } from "../skills/map-design/scripts/lib/color.mjs";
import { editorialTheme } from "../skills/map-design/scripts/lib/themes.mjs";
import { formatNumber } from "../skills/map-design/scripts/lib/svg.mjs";

const theme = editorialTheme("paper");

test("jenks finds obvious clusters", () => {
  const values = [1, 2, 2, 3, 10, 11, 12, 30, 31, 33];
  const b = jenksBreaks(values, 3);
  assert.equal(b.length, 2);
  assert.ok(b[0] > 3 && b[0] < 10, `first break ${b[0]}`);
  assert.ok(b[1] > 12 && b[1] < 30, `second break ${b[1]}`);
});

test("quantile classes put values in order", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const s = colorScale(values, { type: "quantile", classes: 4 }, theme);
  assert.equal(s.colors.length, 4);
  assert.equal(s.color(1), s.colors[0]);
  assert.equal(s.color(100), s.colors[3]);
});

test("threshold breaks are used exactly", () => {
  const s = colorScale([5, 15, 25, 45], { type: "threshold", breaks: [10, 20, 40] }, theme);
  assert.deepEqual(s.breaks, [10, 20, 40]);
  assert.equal(s.color(9.99), s.colors[0]);
  assert.equal(s.color(10), s.colors[1]);
  assert.equal(s.color(45), s.colors[3]);
});

test("categorical scales keep first-seen order", () => {
  const s = colorScale(["b", "a", "b", "c"], { type: "categorical" }, theme);
  assert.deepEqual(s.categories, ["b", "a", "c"]);
  assert.notEqual(s.color("a"), s.color("b"));
});

test("unknown palettes and empty data fail with guidance", () => {
  assert.throws(() => colorScale([1, 2], { palette: "rainbow" }, theme), /Unknown palette/);
  assert.throws(() => colorScale(["x"], {}, theme), /No numeric values/);
});

test("circle areas, not radii, scale with value", () => {
  const r = radiusScale([100], 10);
  assert.equal(r(100), 10);
  assert.ok(Math.abs(r(25) - 5) < 1e-9);
});

test("niceBreak rounds to two significant figures", () => {
  assert.equal(niceBreak(1234), 1200);
  assert.equal(niceBreak(0.0456), 0.046);
});

test("OKLab round-trips and ramps keep their ends", () => {
  for (const hex of ["#C2412D", "#0A3846", "#FFFFFF"]) assert.equal(fromOklab(toOklab(hex)), hex);
  const r = ramp(["#000000", "#FFFFFF"], 3);
  assert.equal(r[0], "#000000");
  assert.equal(r[2], "#FFFFFF");
});

test("numbers format compactly", () => {
  assert.equal(formatNumber(12_500_000, { compact: true }), "12.5M");
  assert.equal(formatNumber(1500, { prefix: "$", compact: true }), "$1.5K");
  assert.equal(formatNumber(37.25, { suffix: "%", decimals: 1 }), "37.3%");
});
