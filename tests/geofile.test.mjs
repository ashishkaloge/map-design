// The user's own geometry: GeoJSON, TopoJSON, GPX and KML in, real maps out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../skills/map-design/scripts/lib/render.mjs";
import { parseGeo, readGeoFile, thinnedPath, simplify, GEOMETRY } from "../skills/map-design/scripts/lib/geofile.mjs";
import { loadRows } from "../skills/map-design/scripts/lib/spec.mjs";
import { usCountyFeatures } from "../skills/map-design/scripts/lib/data.mjs";
import { G } from "../skills/map-design/scripts/lib/geo.mjs";
import { SpecError } from "../skills/map-design/scripts/lib/errors.mjs";

const count = (svg, re) => (svg.match(re) ?? []).length;
const km2 = (f) => G.geoArea(f) * 6371.0088 ** 2;
const dir = () => mkdtempSync(join(tmpdir(), "map-design-geo-"));
const square = (w, s, size = 1) => [[w, s], [w + size, s], [w + size, s + size], [w, s + size], [w, s]];
const fc = (features) => ({ type: "FeatureCollection", features });
const polygon = (properties, ring) => ({ type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } });

// Every ring reversed: the RFC 7946 order most GIS tools write, the opposite of d3's.
const flip = (g) => (g.type === "Polygon"
  ? { type: "Polygon", coordinates: g.coordinates.map((r) => [...r].reverse()) }
  : { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map((r) => [...r].reverse())) });

function californiaCounties(base) {
  const ca = usCountyFeatures().features.filter((f) => String(f.id).startsWith("06"));
  writeFileSync(join(base, "counties.geojson"), JSON.stringify(fc(ca.map((f) => ({
    type: "Feature", properties: { GEOID: String(f.id), NAME: f.properties.name, OBJECTID: Number(f.id) }, geometry: flip(f.geometry),
  })))));
  return ca;
}

test("polygons are wound for d3 whichever order the file uses", () => {
  const ccw = parseGeo(JSON.stringify(fc([polygon({}, square(2, 48))])));
  const cw = parseGeo(JSON.stringify(fc([polygon({}, [...square(2, 48)].reverse())])));
  for (const r of [ccw, cw]) {
    const area = km2(r.collection.features[0]);
    assert.ok(area > 7000 && area < 9000, `1°×1° at 48°N is about 8,200 km², got ${area}`);
  }
  // A hole stays a hole: the ring with one inside it has less area than without.
  const withHole = parseGeo(JSON.stringify(fc([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [square(2, 48), square(2.25, 48.25, 0.5)] } }])));
  assert.ok(km2(withHole.collection.features[0]) < km2(ccw.collection.features[0]) * 0.8);
});

test("open rings are closed and long edges follow the parallel", () => {
  const open = square(-100, 40, 10).slice(0, 4);
  const r = parseGeo(JSON.stringify(fc([polygon({}, open)])));
  const ring = r.collection.features[0].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  // The northern edge at 50°N gets a point every degree, so it does not bow to the pole.
  const north = ring.filter(([, lat]) => lat === 50);
  assert.ok(north.length >= 10, `expected a densified edge, got ${north.length} points`);
});

test("projected coordinates, shapefiles and KMZ stop with a way to convert", () => {
  assert.throws(
    () => parseGeo(JSON.stringify(fc([{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [523412, 181254] } }]))),
    (e) => e instanceof SpecError && /projected/.test(e.message) && /mapshaper|ogr2ogr/.test(e.message),
  );
  const d = dir();
  assert.throws(() => readGeoFile("wards.shp", d), /not read directly.*mapshaper/);
  assert.throws(() => readGeoFile("trip.kmz", d), /unzip/);
  assert.throws(() => readGeoFile("missing.geojson", d), /not found/);
});

test("TopoJSON: the largest object by default, or the one named", () => {
  const topo = {
    type: "Topology",
    arcs: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
    objects: {
      one: { type: "GeometryCollection", geometries: [{ type: "Polygon", arcs: [[0]], properties: { id: "a" } }] },
      two: { type: "GeometryCollection", geometries: [{ type: "Polygon", arcs: [[0]], properties: { id: "a" } }, { type: "Polygon", arcs: [[1]], properties: { id: "b" } }] },
    },
  };
  const r = parseGeo(JSON.stringify(topo), { ext: ".topojson" });
  assert.equal(r.format, "TopoJSON");
  assert.equal(r.collection.features.length, 2);
  assert.match(r.notes.join(" "), /used TopoJSON object "two"/);
  assert.equal(parseGeo(JSON.stringify(topo), { object: "one" }).collection.features.length, 1);
  assert.throws(() => parseGeo(JSON.stringify(topo), { object: "three" }), /Objects: one, two/);
});

test("GPX: waypoints, routes and tracks, with elevation and escaped names", () => {
  const gpx = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="51.5" lon="-0.12"><name>Start &amp; finish</name><ele>12</ele></wpt>
  <rte><name>Plan</name><rtept lat="51.5" lon="-0.12"/><rtept lat="51.6" lon="-0.1"/></rte>
  <trk><name><![CDATA[Morning <run>]]></name>
    <trkseg><trkpt lat="51.5" lon="-0.12"><ele>10</ele></trkpt><trkpt lat="51.51" lon="-0.11"><ele>14</ele></trkpt></trkseg>
    <trkseg><trkpt lat="51.52" lon="-0.1"/><trkpt lat="51.53" lon="-0.09"/></trkseg>
  </trk>
</gpx>`;
  const { collection, format } = parseGeo(gpx, { ext: ".gpx" });
  assert.equal(format, "GPX");
  const [wpt, rte, trk] = collection.features;
  assert.deepEqual(wpt.properties, { gpx: "waypoint", name: "Start & finish", ele: 12 });
  assert.equal(rte.geometry.type, "LineString");
  assert.equal(trk.properties.name, "Morning <run>");
  assert.equal(trk.geometry.type, "MultiLineString");
  assert.deepEqual(trk.geometry.coordinates[0][1], [-0.11, 51.51, 14]);
});

test("KML: placemarks in folders, extended data, holes, multi-geometry and tracks", () => {
  const kml = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Folder>
    <Placemark><name>Park</name><description><![CDATA[<b>Open</b> daily]]></description>
      <ExtendedData><Data name="code"><value>0601</value></Data><SchemaData><SimpleData name="visits">1200</SimpleData></SchemaData></ExtendedData>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>2,48 3,48 3,49 2,49 2,48</coordinates></LinearRing></outerBoundaryIs>
      <innerBoundaryIs><LinearRing><coordinates>2.2,48.2 2.4,48.2 2.4,48.4 2.2,48.4 2.2,48.2</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
    <Placemark><name>Two cafes</name><MultiGeometry><Point><coordinates>2.35,48.85,0</coordinates></Point><Point><coordinates>2.36,48.86</coordinates></Point></MultiGeometry></Placemark>
    <Placemark><gx:Track><when>2024-01-01</when><gx:coord>2 48 1</gx:coord><gx:coord>2.1 48.1 2</gx:coord></gx:Track></Placemark>
  </Folder></Document></kml>`;
  const { collection } = parseGeo(kml, { ext: ".kml" });
  const [park, cafes, track] = collection.features;
  assert.deepEqual(park.properties, { name: "Park", description: "Open daily", code: "0601", visits: 1200 });
  assert.equal(park.geometry.coordinates.length, 2, "outer ring and hole");
  assert.equal(cafes.geometry.type, "GeometryCollection");
  assert.equal(track.geometry.type, "LineString");
});

test("XML entity declarations are never expanded", () => {
  const kml = `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY boom "expanded">]>
<kml><Placemark><name>&boom;</name><Point><coordinates>1,2</coordinates></Point></Placemark></kml>`;
  assert.equal(parseGeo(kml, { ext: ".kml" }).collection.features[0].properties.name, "&boom;");
});

test("a GPS track logged every metre keeps its shape under an azimuthal projection", () => {
  // d3's whole-sphere clip circle drops vertices within ~6 m of the previous
  // one, which would collapse this walk to a single point.
  const walk = Array.from({ length: 2000 }, (_, i) => [-9.15 + i * 0.0000162, 38.72 + 0.002 * Math.sin(i / 300)]);
  const line = { type: "LineString", coordinates: walk };
  const projection = G.geoAzimuthalEqualArea().rotate([9.12, -38.72]);
  projection.clipAngle(null).fitExtent([[0, 0], [1500, 1500]], line).clipAngle(179.999);
  const pts = thinnedPath(projection, 0.25)(line).slice(1).split("L").map((p) => p.split(",").map(Number));
  assert.ok(pts.length > 20 && pts.length < 200, `thinned to ${pts.length} vertices`);
  let worst = 0;
  for (const p of walk) {
    const q = projection(p);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [dx, dy] = [pts[i][0] - ax, pts[i][1] - ay];
      const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(ax + t * dx - q[0], ay + t * dy - q[1]));
    }
    worst = Math.max(worst, best);
  }
  assert.ok(worst < 0.5, `drawn line strays ${worst.toFixed(2)} px from the track`);
  assert.equal(projection.clipAngle(), 179.999, "the projection's clip is restored");
  assert.equal(simplify([[0, 0], [1, 0.1], [2, 0], [3, 5], [4, 0]], 0.5).length, 4);
});

test("choropleth on your own boundaries: codes join without leading zeros, misses are reported", async () => {
  const base = dir();
  const ca = californiaCounties(base);
  const rows = ca.map((f, i) => ({ fips: Number(f.id), age: 30 + (i % 15) })).slice(0, 50);
  rows.push({ fips: 99999, age: 40 });
  const r = await render({ kind: "choropleth", boundaries: "counties.geojson", data: rows, value: "age" }, { base, embedFonts: false });
  assert.equal(count(r.svg, /data-value="No data"/g), 8, "the eight counties without rows draw as no data");
  assert.equal(count(r.svg, /<path [^>]*data-value="\d/g), 50);
  assert.equal(r.report.unmatched.length, 1);
  assert.match(r.report.unmatched[0].reason, /99999/);
  assert.ok(r.report.notes.some((n) => /column "fips" to property "GEOID"/.test(n)));
  assert.match(r.svg, /data-name="Los Angeles"/);
  // Areas sit at the right place: Los Angeles is south-east of San Francisco on the page.
  const at = (name) => r.svg.match(new RegExp(`<path d="M([\\d.]+),([\\d.]+)[^"]*"[^>]*data-name="${name}"`)).slice(1).map(Number);
  const [la, sf] = [at("Los Angeles"), at("San Francisco")];
  assert.ok(la[0] > sf[0] && la[1] > sf[1]);
});

test("choropleth from one polygon file, with the value picked or asked for", async () => {
  const base = dir();
  const features = [polygon({ name: "North", OBJECTID: 1, rate: 3.5 }, square(10, 50)), polygon({ name: "South", OBJECTID: 2, rate: 7 }, square(10, 49))];
  writeFileSync(join(base, "zones.geojson"), JSON.stringify(fc(features)));
  const r = await render({ kind: "choropleth", data: "zones.geojson" }, { base, embedFonts: false });
  assert.match(r.svg, /data-name="North" data-value="3.5"/);
  assert.ok(r.report.warnings.some((w) => /using the "rate" column/.test(w)), "OBJECTID is never picked as the value");
  writeFileSync(join(base, "two.geojson"), JSON.stringify(fc(features.map((f) => ({ ...f, properties: { ...f.properties, other: 1 } })))));
  await assert.rejects(render({ kind: "choropleth", data: "two.geojson" }, { base, embedFonts: false }), /Set "value".*rate, other/);
});

test("local boundaries stand alone without 1:50m coastlines", async () => {
  const base = dir();
  const cells = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cells.push(polygon({ name: `Ward ${i}${j}`, v: i + j }, square(-9.2 + i * 0.02, 38.7 + j * 0.02, 0.02)));
  writeFileSync(join(base, "wards.geojson"), JSON.stringify(fc(cells)));
  const r = await render({ kind: "choropleth", data: "wards.geojson", value: "v" }, { base, embedFonts: false });
  assert.match(r.svg, /<g class="base"><\/g>/);
  assert.match(r.svg, /<g class="borders"><\/g>/);
  assert.equal(count(r.svg, /data-name="Ward/g), 16);
  assert.ok(r.report.notes.some((n) => /basemap": "streets"/.test(n)));
});

test("points, bubbles and spikes read locations from point features", async () => {
  const base = dir();
  writeFileSync(join(base, "shops.geojson"), JSON.stringify(fc([
    { type: "Feature", properties: { name: "Alfama", sales: 3 }, geometry: { type: "Point", coordinates: [-9.13, 38.71] } },
    { type: "Feature", properties: { name: "Belém", sales: 5 }, geometry: { type: "Point", coordinates: [-9.2, 38.7] } },
    { type: "Feature", properties: { name: "Path" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
    { type: "Feature", properties: { name: "No geometry", country: "Portugal", sales: 1 }, geometry: null },
  ])));
  const r = await render({ kind: "bubbles", data: "shops.geojson", value: "sales" }, { base, embedFonts: false });
  assert.equal(count(r.svg, /<circle [^>]*data-name/g), 3, "two points plus the row located by its country");
  assert.ok(r.report.resolved.some((x) => x.as === "point geometry" && x.lon === -9.2));
  assert.match(r.report.unmatched.map((u) => u.reason).join(" "), /is a line/);
});

test("rows from a FeatureCollection .json keep features without geometry", () => {
  const base = dir();
  writeFileSync(join(base, "rows.json"), JSON.stringify(fc([{ type: "Feature", properties: { iso3: "KEN", v: 1 }, geometry: null }])));
  const rows = loadRows("rows.json", base);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ iso3: "KEN", v: 1 }]);
  assert.equal(rows[0][GEOMETRY], null);
  assert.deepEqual(Object.keys(rows[0]), ["iso3", "v"], "the geometry does not show up as a column");
  // A table whose geometry is projected still loads as a table, with the reason noted.
  writeFileSync(join(base, "utm.json"), JSON.stringify(fc([{ type: "Feature", properties: { iso3: "KEN", v: 1 }, geometry: { type: "Point", coordinates: [523412, 181254] } }])));
  const report = { notes: [] };
  const utm = loadRows("utm.json", base, "data", report);
  assert.equal(utm[0].iso3, "KEN");
  assert.equal(utm[0][GEOMETRY], null);
  assert.match(report.notes.join(" "), /projected coordinate system.*Geometry was ignored/);
});

test("route from a GPX track: drawn as recorded, framed tightly, length reported", async () => {
  const base = dir();
  const pts = Array.from({ length: 600 }, (_, i) => {
    const t = (i / 599) * 2 * Math.PI;
    return `<trkpt lat="${(38.72 + 0.02 * Math.sin(t)).toFixed(6)}" lon="${(-9.15 + 0.026 * Math.cos(t)).toFixed(6)}"/>`;
  }).join("");
  writeFileSync(join(base, "run.gpx"), `<gpx><wpt lat="38.72" lon="-9.124"><name>Start</name></wpt><trk><name>Loop</name><trkseg>${pts}</trkseg></trk></gpx>`);
  const r = await render({ kind: "route", track: "run.gpx", title: "Loop" }, { base, embedFonts: false });
  assert.equal(count(r.svg, /class="route"/g), 1);
  assert.match(r.svg, />Start</);
  const note = r.report.notes.find((n) => /^Track length/.test(n));
  assert.match(note, /Track length: 1\d\.\d km/, note);
  assert.match(r.svg, /<g class="base"><\/g>/, "a local track has no Natural Earth context");
  // Several tracks in one map, each with its own legend entry.
  writeFileSync(join(base, "b.gpx"), `<gpx><trk><name>Other</name><trkseg><trkpt lat="38.7" lon="-9.2"/><trkpt lat="38.71" lon="-9.19"/></trkseg></trk></gpx>`);
  const two = await render({ kind: "route", routes: [{ track: "run.gpx" }, { track: "b.gpx" }] }, { base, embedFonts: false });
  assert.equal(count(two.svg, /class="route"/g), 2);
  assert.match(two.svg, />Other</);
  await assert.rejects(render({ kind: "route", track: "missing.gpx" }, { base, embedFonts: false }), /not found/);
});

test("locator highlights an area from a file and marks cities inside it", async () => {
  const base = dir();
  californiaCounties(base);
  const r = await render({ kind: "locator", highlight: { file: "counties.geojson", label: "California" }, cities: 3 }, { base, embedFonts: false });
  assert.match(r.svg, />CALIFORNIA</);
  assert.match(r.svg, />Los Angeles</);
  assert.doesNotMatch(r.svg, />Phoenix</);
});

test("areas join on the feature's own id, as plotly and us-atlas county files store it", async () => {
  const base = dir();
  const features = [
    { type: "Feature", id: "06037", properties: { NAME: "Los Angeles" }, geometry: { type: "Polygon", coordinates: [square(-118.5, 34)] } },
    { type: "Feature", id: "06075", properties: { NAME: "San Francisco" }, geometry: { type: "Polygon", coordinates: [square(-122.5, 37.5)] } },
  ];
  writeFileSync(join(base, "counties.geojson"), JSON.stringify(fc(features)));
  const rows = [{ fips: 6037, rate: 5 }, { fips: "06075", rate: 3 }];
  const r = await render({ kind: "choropleth", boundaries: "counties.geojson", data: rows, value: "rate" }, { base, embedFonts: false });
  assert.equal(r.report.unmatched.length, 0);
  assert.match(r.svg, /data-name="Los Angeles" data-value="5"/);
  assert.ok(r.report.notes.some((n) => /column "fips" to property "@id"/.test(n)));
  // TopoJSON keeps the id on each geometry; it survives into the features.
  const topo = {
    type: "Topology",
    arcs: [square(-118.5, 34), square(-122.5, 37.5)],
    objects: { counties: { type: "GeometryCollection", geometries: [
      { type: "Polygon", id: "06037", arcs: [[0]], properties: { name: "Los Angeles" } },
      { type: "Polygon", id: "06075", arcs: [[1]], properties: { name: "San Francisco" } },
    ] } },
  };
  writeFileSync(join(base, "counties.topojson"), JSON.stringify(topo));
  const t = await render({ kind: "choropleth", boundaries: { file: "counties.topojson", id: "@id" }, data: rows, join: "fips", value: "rate" }, { base, embedFonts: false });
  assert.equal(t.report.unmatched.length, 0);
  assert.match(t.svg, /data-name="San Francisco" data-value="3"/);
});
