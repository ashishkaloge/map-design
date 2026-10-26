import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, newReport } from "../skills/map-design/scripts/lib/render.mjs";
import { prepare } from "../skills/map-design/scripts/lib/kinds/choropleth.mjs";
import { editorialTheme } from "../skills/map-design/scripts/lib/themes.mjs";
import { frame, G } from "../skills/map-design/scripts/lib/geo.mjs";
import { loadRows } from "../skills/map-design/scripts/lib/spec.mjs";
import { GEOMETRY } from "../skills/map-design/scripts/lib/geofile.mjs";

// Small synthetic fixtures make the association between each area and value explicit.
const polygon = (properties, x) => ({
  type: "Feature", properties,
  geometry: { type: "Polygon", coordinates: [[[x, 30], [x + 0.1, 30], [x + 0.1, 30.1], [x, 30.1], [x, 30]]] },
});
const collection = (features) => ({ type: "FeatureCollection", features });
const baseDir = () => mkdtempSync(join(tmpdir(), "map-design-renderer-test-"));
function boundaries(base, features) {
  writeFileSync(join(base, "areas.geojson"), JSON.stringify(collection(features)));
}
const pathsWithValue = (svg, value) => (svg.match(new RegExp(`<path [^>]*data-value="${value}"`, "g")) ?? []).length;

test("automatic area joins use distinct identifiers instead of repeated metadata", async () => {
  const base = baseDir();
  boundaries(base, [polygon({ country: "X", id: "a", name: "A" }, 10), polygon({ country: "X", id: "b", name: "B" }, 12)]);
  const data = [{ country: "X", id: "a", rate: 5 }, { country: "X", id: "b", rate: 25 }];
  const result = await render({ kind: "choropleth", boundaries: "areas.geojson", data, value: "rate" }, { base, embedFonts: false });
  assert.ok(result.report.notes.some((note) => /column "id" to property "id"/.test(note)));
  assert.equal(pathsWithValue(result.svg, 5), 1);
  assert.equal(pathsWithValue(result.svg, 25), 1);
  assert.equal(result.report.warnings.length, 0);
});

test("equally complete joins with different area assignments require an explicit choice", async () => {
  const base = baseDir();
  boundaries(base, [polygon({ id: "a", name: "Alpha" }, 10), polygon({ id: "b", name: "Beta" }, 12)]);
  const data = [{ id: "a", name: "Beta", rate: 5 }, { id: "b", name: "Alpha", rate: 25 }];
  const spec = { kind: "choropleth", boundaries: "areas.geojson", data, value: "rate" };
  await assert.rejects(render(spec, { base, embedFonts: false }), /Ambiguous area join.*Set "join" and "boundaries.id"/);
  const chosen = await render({ ...spec, join: "id", boundaries: { file: "areas.geojson", id: "id" } }, { base, embedFonts: false });
  assert.equal(pathsWithValue(chosen.svg, 5), 1);
  assert.equal(pathsWithValue(chosen.svg, 25), 1);
});

test("equivalent aliases are accepted and chosen independently of property ordering", async () => {
  const base = baseDir();
  const spec = { kind: "choropleth", boundaries: "areas.geojson", value: "rate" };
  const notes = [];
  for (const reversed of [false, true]) {
    const props = (id) => reversed ? { id, code: id } : { code: id, id };
    boundaries(base, [polygon(props("a"), 10), polygon(props("b"), 12)]);
    const data = [{ ...props("a"), rate: 5 }, { ...props("b"), rate: 25 }];
    const result = await render({ ...spec, data }, { base, embedFonts: false });
    notes.push(result.report.notes.find((note) => /matched data column/.test(note)));
    assert.equal(pathsWithValue(result.svg, 5), 1);
    assert.equal(pathsWithValue(result.svg, 25), 1);
  }
  assert.equal(notes[0], notes[1]);
});

test("explicit area IDs preserve multipart grouping and report duplicate data rows", async () => {
  const base = baseDir();
  boundaries(base, [polygon({ id: "a", name: "A" }, 10), polygon({ id: "a", name: "A" }, 10.2), polygon({ id: "b", name: "B" }, 12)]);
  const result = await render({
    kind: "choropleth", boundaries: { file: "areas.geojson", id: "id" }, join: "id", value: "rate",
    data: [{ id: "a", rate: 5 }, { id: "a", rate: 6 }, { id: "b", rate: 25 }],
  }, { base, embedFonts: false });
  assert.equal(pathsWithValue(result.svg, 5), 1);
  assert.equal(pathsWithValue(result.svg, 6), 0);
  assert.equal(pathsWithValue(result.svg, 25), 1);
  assert.ok(result.report.warnings.some((warning) => /kept the first/.test(warning)));
  const multipart = result.svg.match(/<path d="([^"]*)"[^>]*data-value="5"/)[1];
  assert.equal((multipart.match(/M/g) ?? []).length, 2);
});

test("explicit joins examine rows beyond the first thousand", async () => {
  const base = baseDir();
  boundaries(base, [polygon({ id: "a", name: "A" }, 10)]);
  const data = Array.from({ length: 1000 }, (_, i) => ({ id: `missing${i}`, rate: 1 }));
  data.push({ id: "a", rate: 5 });
  const result = await render({ kind: "choropleth", boundaries: { file: "areas.geojson", id: "id" }, join: "id", value: "rate", data }, { base, embedFonts: false });
  assert.equal(pathsWithValue(result.svg, 5), 1);
  assert.equal(result.report.unmatched.length, 1000);
});

test("automatic framing includes supplied areas with no matching data", () => {
  const base = baseDir();
  boundaries(base, [polygon({ id: "a", name: "A" }, 10), polygon({ id: "b", name: "B" }, 12)]);
  const kind = prepare({
    spec: { kind: "choropleth", boundaries: { file: "areas.geojson", id: "id" }, join: "id", value: "rate" },
    base, theme: editorialTheme("paper"), rows: [{ id: "a", rate: 5 }], report: newReport(),
  });
  const { projection } = frame({ region: "auto", _tight: kind.tight }, [[0, 0], [1000, 1000]], kind.dataObject);
  for (const lon of [10, 10.1, 12, 12.1]) for (const lat of [30, 30.1]) {
    const [x, y] = projection([lon, lat]);
    assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= 1000, `${lon},${lat} is outside the map`);
  }
});

for (const input of ["boundaries", "data"]) {
  test(`mixed collections use only polygons for choropleth ${input}`, async () => {
    const base = baseDir();
    const first = polygon({ name: "Area", rate: 5 }, 10);
    const second = polygon({}, 10.2).geometry;
    const onlyAreas = { ...first, geometry: { type: "GeometryCollection", geometries: [first.geometry, second] } };
    const mixed = {
      ...first,
      geometry: { type: "GeometryCollection", geometries: [first.geometry, {
        type: "GeometryCollection", geometries: [
          second,
          { type: "Point", coordinates: [100, 30] },
          { type: "LineString", coordinates: [[80, 20], [81, 21]] },
        ],
      }] },
    };
    const spec = { kind: "choropleth", [input]: "areas.geojson", value: "rate", labels: false };
    boundaries(base, [onlyAreas]);
    const expected = await render(spec, { base, embedFonts: false });
    boundaries(base, [mixed]);
    const report = newReport();
    const kind = prepare({
      spec, base, theme: editorialTheme("paper"), report,
      rows: input === "data" ? loadRows("areas.geojson", base, "data", report) : [],
    });
    const [[west, south], [east, north]] = G.geoBounds(kind.dataObject);
    assert.ok(west >= 10 && east <= 10.31 && south >= 30 && north <= 30.11,
      `non-area geometry changed the frame: ${JSON.stringify([[west, south], [east, north]])}`);
    const actual = await render(spec, { base, embedFonts: false });
    const areaPath = (svg) => svg.match(/<path d="([^"]*)"[^>]*data-value="5"/)[1];
    assert.equal(areaPath(actual.svg), areaPath(expected.svg), "points and lines must not appear in the shaded area path");
    assert.equal((areaPath(actual.svg).match(/M/g) ?? []).length, 2, "both polygon parts remain visible");
  });
}

test("explicit tracks reject partial invalid geometry in every supported file format", async () => {
  const base = baseDir();
  const valid = [[-9.15, 38.72], [-9.14, 38.73]];
  const invalid = [[523412, 181254], [523422, 181264]];
  const geojson = JSON.stringify(collection([valid, invalid].map((coordinates) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }))));
  const topojson = JSON.stringify({ type: "Topology", arcs: [valid, invalid], objects: { tracks: { type: "GeometryCollection", geometries: [{ type: "LineString", arcs: [0] }, { type: "LineString", arcs: [1] }] } } });
  const gpx = `<gpx>${[valid, invalid].map((line) => `<trk><trkseg>${line.map(([lon, lat]) => `<trkpt lon="${lon}" lat="${lat}"/>`).join("")}</trkseg></trk>`).join("")}</gpx>`;
  const kml = `<kml><Document>${[valid, invalid].map((line) => `<Placemark><LineString><coordinates>${line.map((point) => point.join(",")).join(" ")}</coordinates></LineString></Placemark>`).join("")}</Document></kml>`;
  for (const [ext, content] of [["geojson", geojson], ["json", geojson], ["topojson", topojson], ["gpx", gpx], ["kml", kml]]) {
    const file = `tracks.${ext}`;
    writeFileSync(join(base, file), content);
    await assert.rejects(render({ kind: "route", track: file }, { base, embedFonts: false }), /projected coordinate system/, ext);
    await assert.rejects(render({ kind: "route", routes: [{ track: file }] }, { base, embedFonts: false }), /projected coordinate system/, `routes[].track ${ext}`);
  }
  const report = newReport();
  const rows = loadRows("tracks.json", base, "data", report);
  assert.equal(rows.length, 2, "ordinary table loading retains both property rows");
  assert.equal(rows[1][GEOMETRY], null);
  assert.ok(report.notes.some((note) => /Geometry was ignored/.test(note)));
});
