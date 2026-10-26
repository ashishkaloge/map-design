import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../skills/map-design/scripts/lib/render.mjs";
import { SpecError } from "../skills/map-design/scripts/lib/errors.mjs";

const polygon = { type: "Polygon", coordinates: [[[10, 30], [11, 30], [11, 31], [10, 31], [10, 30]]] };
const feature = (geometry, properties = {}) => ({ type: "Feature", properties, geometry });
const setup = (features) => {
  const base = mkdtempSync(join(tmpdir(), "map-locator-geometry-"));
  writeFileSync(join(base, "places.geojson"), JSON.stringify({ type: "FeatureCollection", features }));
  return base;
};
const spec = (highlight = "places.geojson") => ({ kind: "locator", highlight, inset: false, contextLabels: false });

test("locator marks every point in MultiPoint and nested GeometryCollection files", async () => {
  const base = setup([
    feature({ type: "MultiPoint", coordinates: [[10, 30], [10.1, 30.1]] }, { name: "First pair" }),
    feature({ type: "GeometryCollection", geometries: [
      { type: "Point", coordinates: [10.2, 30.2] },
      { type: "GeometryCollection", geometries: [{ type: "MultiPoint", coordinates: [[10.3, 30.3], [10.4, 30.4]] }] },
    ] }, { name: "Other places" }),
  ]);
  const result = await render(spec(), { base, embedFonts: false });
  assert.equal((result.svg.match(/fill-opacity="0.16"/g) ?? []).length, 5);
  assert.ok(result.report.resolved.some((r) => r.as === "5 point(s) from GeoJSON"));
  assert.doesNotMatch(result.svg, /NaN|Infinity/);
});

test("locator extracts both areas and point markers from a mixed geometry collection", async () => {
  const base = setup([feature({ type: "GeometryCollection", geometries: [
    polygon,
    { type: "MultiPoint", coordinates: [[10.3, 30.3], [10.7, 30.7]] },
  ] }, { name: "Site" })]);
  const result = await render(spec(), { base, embedFonts: false });
  assert.match(result.svg, /data-name="Site"/);
  assert.equal((result.svg.match(/fill-opacity="0.16"/g) ?? []).length, 2);
  assert.ok(result.report.resolved.some((r) => r.as === "1 area(s) from GeoJSON"));
  assert.ok(result.report.resolved.some((r) => r.as === "2 point(s) from GeoJSON"));
});

test("locator converts numeric feature names and explicit labels to text", async () => {
  for (const name of [0, 123]) {
    const base = setup([feature(polygon, { name })]);
    const result = await render(spec(), { base, embedFonts: false });
    assert.match(result.svg, new RegExp(`data-name="${name}"`));
    const overridden = await render(spec({ file: "places.geojson", label: 456 }), { base, embedFonts: false });
    assert.match(overridden.svg, /data-name="456"/);
  }
});

test("an earlier highlight cannot hide a later file without areas or points", async () => {
  const base = setup([feature({ type: "LineString", coordinates: [[10, 30], [11, 31]] })]);
  await assert.rejects(
    render(spec([{ lon: 10, lat: 30 }, "places.geojson"]), { base, embedFonts: false }),
    (e) => e instanceof SpecError && /places\.geojson has no areas or points/.test(e.message),
  );
});
