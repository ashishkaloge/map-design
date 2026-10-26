import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeo } from "../skills/map-design/scripts/lib/geofile.mjs";
import { SpecError } from "../skills/map-design/scripts/lib/errors.mjs";

const feature = (geometry, properties = { name: "Area", value: 7 }) => ({ type: "Feature", properties, geometry });
const point = { type: "Point", coordinates: [10, 50] };
const collection = (...features) => ({ type: "FeatureCollection", features });
const parse = (value, options) => parseGeo(JSON.stringify(value), options);
const namedCrs = (name) => ({ type: "name", properties: { name } });

test("declared projected coordinates are rejected even when their numbers resemble degrees", () => {
  for (const id of ["EPSG:3857", "urn:ogc:def:crs:EPSG::27700", "EPSG:43260", "not-CRS84"]) {
    const input = { ...collection(feature(point)), crs: namedCrs(id) };
    assert.throws(() => parse(input), (e) => e instanceof SpecError && /coordinate system.*longitude\/latitude/.test(e.message) && /ogr2ogr/.test(e.message));
    const table = parse(input, { rows: true });
    assert.deepEqual(table.collection.features[0].properties, { name: "Area", value: 7 });
    assert.equal(table.collection.features[0].geometry, null);
    assert.match(table.notes.join(" "), /Geometry was ignored/);
  }
});

test("recognized geographic CRS identifiers retain geometry", () => {
  for (const id of [
    "EPSG:4326", "EPSG::4269", "CRS84", "OGC:CRS84", "WGS 84",
    "urn:ogc:def:crs:EPSG::4326", "urn:ogc:def:crs:EPSG:6.6:4326",
    "urn:x-ogc:def:crs:EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84",
    "http://www.opengis.net/def/crs/EPSG/0/4326",
    "https://www.opengis.net/def/crs/OGC/1.3/CRS84",
    "http://www.opengis.net/gml/srs/epsg.xml#4326",
  ]) {
    const result = parse({ ...collection(feature(point)), crs: namedCrs(id) });
    assert.deepEqual(result.collection.features[0].geometry, point, id);
    assert.deepEqual(result.notes, [], id);
  }
  const legacy = parse({ ...feature(point), crs: { type: "EPSG", properties: { code: 4326 } } });
  assert.deepEqual(legacy.collection.features[0].geometry, point);
});

test("unknown CRS objects fail as SpecError and nested declarations are checked", () => {
  assert.throws(() => parse({ ...feature(point), crs: { type: 42 } }), SpecError);
  for (const bad of [
    { ...feature(point), crs: namedCrs("EPSG:3857") },
    feature({ type: "GeometryCollection", geometries: [{ ...point, crs: namedCrs("EPSG:3857") }] }),
  ]) {
    const input = collection(feature(point, { name: "Good" }), bad);
    assert.throws(() => parse(input), SpecError);
    const table = parse(input, { rows: true });
    assert.deepEqual(table.collection.features[0].geometry, point);
    assert.equal(table.collection.features[1].geometry, null);
    assert.deepEqual(table.collection.features[1].properties, bad.properties);
  }
});

test("TopoJSON declarations receive the same coordinate-system validation", () => {
  const topology = { type: "Topology", crs: namedCrs("EPSG:3857"), objects: { places: { ...point, properties: { name: "Projected" } } }, arcs: [] };
  assert.throws(() => parse(topology), (e) => e instanceof SpecError && /coordinate system/.test(e.message));
  const table = parse(topology, { rows: true });
  assert.equal(table.collection.features[0].geometry, null);
  assert.equal(table.collection.features[0].properties.name, "Projected");
});

test("empty GPX coordinates cannot create a point at zero", () => {
  for (const attrs of ['lat="" lon="0"', 'lat="0" lon=""', 'lat=" " lon="0"', 'lat="0"']) {
    const input = `<gpx><wpt lat="0" lon="0"><name>Valid zero</name></wpt><wpt ${attrs}><name>Invalid</name></wpt></gpx>`;
    assert.throws(() => parseGeo(input, { ext: ".gpx" }), SpecError);
    const table = parseGeo(input, { ext: ".gpx", rows: true });
    assert.deepEqual(table.collection.features[0].geometry.coordinates, [0, 0]);
    assert.equal(table.collection.features[1].geometry, null);
    assert.equal(table.collection.features[1].properties.name, "Invalid");
    assert.match(table.notes.join(" "), /coordinate.*not a number/);
  }
});

test("empty KML coordinate fields cannot create a point at zero", () => {
  for (const coordinates of ["2,,3", ",48,0", ",,0"]) {
    const input = `<kml><Placemark><name>Valid zero</name><Point><coordinates>0,0,0</coordinates></Point></Placemark><Placemark><name>Invalid</name><Point><coordinates>${coordinates}</coordinates></Point></Placemark></kml>`;
    assert.throws(() => parseGeo(input, { ext: ".kml" }), SpecError);
    const table = parseGeo(input, { ext: ".kml", rows: true });
    assert.deepEqual(table.collection.features[0].geometry.coordinates, [0, 0, 0]);
    assert.equal(table.collection.features[1].geometry, null);
    assert.equal(table.collection.features[1].properties.name, "Invalid");
  }
});

test("malformed geometry arrays produce SpecError and retain properties only in table mode", () => {
  const invalid = [
    { type: "Point", coordinates: { lon: 2, lat: 48 } },
    { type: "Point", coordinates: [2] },
    { type: "MultiPoint", coordinates: { lon: 2, lat: 48 } },
    { type: "MultiPoint", coordinates: [[2, 48], null] },
    { type: "LineString", coordinates: "2,48 3,49" },
    { type: "MultiLineString", coordinates: {} },
    { type: "MultiLineString", coordinates: [null] },
    { type: "Polygon", coordinates: [[null, [2, 48], [3, 49]]] },
    { type: "MultiPolygon", coordinates: {} },
    { type: "GeometryCollection", geometries: {} },
    { type: "GeometryCollection", geometries: [point, null] },
  ];
  for (const geometry of invalid) {
    const input = collection(feature(point, { name: "Valid" }), feature(geometry));
    assert.throws(() => parse(input), SpecError, JSON.stringify(geometry));
    const table = parse(input, { rows: true });
    assert.deepEqual(table.collection.features[0].geometry, point);
    assert.equal(table.collection.features[1].geometry, null);
    assert.deepEqual(table.collection.features[1].properties, { name: "Area", value: 7 });
    assert.match(table.notes.join(" "), /Geometry was ignored/);
  }
});

test("invalid intermediate line positions are rejected rather than bridged", () => {
  for (const position of [null, [], [2], "bad", [2, null]]) {
    const input = feature({ type: "LineString", coordinates: [[2, 48], position, [3, 49]] });
    assert.throws(() => parse(input), SpecError);
    const table = parse(input, { rows: true });
    assert.equal(table.collection.features[0].geometry, null);
    assert.match(table.notes.join(" "), /Geometry was ignored/);
  }
});

test("properties-only rows and empty geometry stay usable as tables", () => {
  const input = collection(feature(null, { country: "Portugal", value: 1 }), feature({ type: "Point", coordinates: [] }, { country: "India", value: 2 }));
  const table = parse(input, { rows: true });
  assert.deepEqual(table.collection.features.map((f) => f.properties.country), ["Portugal", "India"]);
  assert.ok(table.collection.features.every((f) => f.geometry === null));
});

test("malformed TopoJSON arcs produce an actionable SpecError", () => {
  const topology = { type: "Topology", arcs: [], objects: { line: { type: "LineString", arcs: [42] } } };
  assert.throws(() => parse(topology), (e) => e instanceof SpecError && /TopoJSON.*arc arrays/.test(e.message));
});
